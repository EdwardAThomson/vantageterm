#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod stt;
mod tts;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

struct AppState {
    // The folder VantageTerm was launched in, used as a fallback project.
    // Per-call roots (below) let one window drive many projects.
    root: PathBuf,
    // True only when a folder was passed explicitly on the command line, so the
    // frontend can avoid force-adding the dev launch dir as a project.
    launch_explicit: bool,
    ptys: Mutex<HashMap<u32, PtySession>>,
    next_pty_id: Mutex<u32>,
}

#[derive(Serialize, Clone)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize, Clone)]
struct PtyOutput {
    id: u32,
    data: Vec<u8>,
}

#[derive(Serialize, Clone)]
struct PtyExit {
    id: u32,
    // Whether the shell exited with status 0 (`exit` at the prompt) rather
    // than being killed or crashing; the frontend only auto-closes the tab
    // for clean exits so failure output stays readable.
    clean: bool,
}

#[derive(Serialize, Clone)]
struct GitChange {
    path: String,
    status: String,
}

fn workspace_dir() -> (PathBuf, bool) {
    // Optional CLI arg names the folder to open (explicit); otherwise fall back
    // to the process cwd (not explicit). Under `tauri dev` the cwd is src-tauri,
    // which is never what the user wants, so step up to the project root.
    if let Some(arg) = std::env::args().nth(1) {
        if let Ok(p) = std::fs::canonicalize(&arg) {
            return (p, true);
        }
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    if cwd.file_name().is_some_and(|n| n == "src-tauri") {
        if let Some(parent) = cwd.parent() {
            return (parent.to_path_buf(), false);
        }
    }
    (cwd, false)
}

#[tauri::command]
fn workspace_root(state: State<AppState>) -> String {
    state.root.to_string_lossy().into_owned()
}

#[tauri::command]
fn launched_with_folder(state: State<AppState>) -> bool {
    state.launch_explicit
}

#[tauri::command]
fn canonicalize(path: String) -> Result<String, String> {
    std::fs::canonicalize(&path)
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = std::fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name() != ".git")
        .map(|e| {
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            DirEntry {
                name: e.file_name().to_string_lossy().into_owned(),
                path: e.path().to_string_lossy().into_owned(),
                is_dir,
            }
        })
        .collect();
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        return Err("already exists".into());
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, "").map_err(|e| e.to_string())
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    if Path::new(&to).exists() {
        return Err("target already exists".into());
    }
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    }
}

fn git_in(root: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn git_status(root: String) -> Result<Vec<GitChange>, String> {
    let out = git_in(Path::new(&root), &["status", "--porcelain=v1", "-z"])?;
    if !out.status.success() {
        // Not a git repo (or other git failure): report no changes.
        return Ok(vec![]);
    }
    let raw = String::from_utf8_lossy(&out.stdout);
    let mut changes = Vec::new();
    let mut fields = raw.split('\0').peekable();
    while let Some(entry) = fields.next() {
        if entry.len() < 4 {
            continue;
        }
        let status = entry[..2].to_string();
        let path = entry[3..].to_string();
        // Renames ship the original path as an extra NUL-separated field.
        if status.starts_with('R') || status.starts_with('C') {
            fields.next();
        }
        changes.push(GitChange { path, status });
    }
    Ok(changes)
}

#[tauri::command]
fn git_head_file(root: String, path: String) -> Result<String, String> {
    // `path` is relative to the given project root. Missing from HEAD
    // (new/untracked file, or no commits yet) is not an error: the diff
    // baseline is just empty.
    let spec = format!("HEAD:{}", path);
    let out = git_in(Path::new(&root), &["show", &spec])?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    state: State<AppState>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = {
        let mut next = state.next_pty_id.lock().unwrap();
        *next += 1;
        *next
    };

    let app_for_reader = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app_for_reader.emit(
                        "pty-output",
                        PtyOutput {
                            id,
                            data: buf[..n].to_vec(),
                        },
                    );
                }
            }
        }
        // EOF: the shell is gone. Take the session out of the map (dropping
        // the lock before the wait) and reap the child for its exit status.
        let session = app_for_reader
            .state::<AppState>()
            .ptys
            .lock()
            .unwrap()
            .remove(&id);
        let clean = match session {
            Some(mut s) => s.child.wait().map(|st| st.success()).unwrap_or(false),
            // Already removed by pty_kill: the tab was closed first.
            None => false,
        };
        let _ = app_for_reader.emit("pty-exit", PtyExit { id, clean });
    });

    state.ptys.lock().unwrap().insert(
        id,
        PtySession {
            master: pair.master,
            writer,
            child,
        },
    );
    Ok(id)
}

#[tauri::command]
fn pty_write(state: State<AppState>, id: u32, data: String) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    let session = ptys.get_mut(&id).ok_or("no such pty")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(state: State<AppState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let ptys = state.ptys.lock().unwrap();
    let session = ptys.get(&id).ok_or("no such pty")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_kill(state: State<AppState>, id: u32) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    if let Some(mut session) = ptys.remove(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}

fn main() {
    let (root, launch_explicit) = workspace_dir();
    let state = AppState {
        root,
        launch_explicit,
        ptys: Mutex::new(HashMap::new()),
        next_pty_id: Mutex::new(0),
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            workspace_root,
            launched_with_folder,
            canonicalize,
            list_dir,
            read_file,
            write_file,
            create_file,
            create_dir,
            rename_path,
            delete_path,
            git_status,
            git_head_file,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            stt::stt_available,
            stt::stt_start,
            stt::stt_stop,
            tts::tts_available,
            tts::tts_speak,
            tts::tts_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
