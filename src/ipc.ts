import { invoke } from "@tauri-apps/api/core";

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface GitChange {
  path: string;
  status: string;
}

export const workspaceRoot = () => invoke<string>("workspace_root");
export const launchedWithFolder = () => invoke<boolean>("launched_with_folder");
export const canonicalize = (path: string) => invoke<string>("canonicalize", { path });
export const listDir = (path: string) => invoke<DirEntry[]>("list_dir", { path });
export const readFile = (path: string) => invoke<string>("read_file", { path });
export const writeFile = (path: string, content: string) =>
  invoke<void>("write_file", { path, content });
export const createFile = (path: string) => invoke<void>("create_file", { path });
export const createDir = (path: string) => invoke<void>("create_dir", { path });
export const renamePath = (from: string, to: string) =>
  invoke<void>("rename_path", { from, to });
export const deletePath = (path: string) => invoke<void>("delete_path", { path });
export const gitStatus = (root: string) =>
  invoke<GitChange[]>("git_status", { root });
export const gitHeadFile = (root: string, path: string) =>
  invoke<string>("git_head_file", { root, path });

export const ptySpawn = (cwd: string, cols: number, rows: number) =>
  invoke<number>("pty_spawn", { cwd, cols, rows });
export const ptyWrite = (id: number, data: string) =>
  invoke<void>("pty_write", { id, data });
export const ptyResize = (id: number, cols: number, rows: number) =>
  invoke<void>("pty_resize", { id, cols, rows });
export const ptyKill = (id: number) => invoke<void>("pty_kill", { id });
