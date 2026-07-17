import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { readFile, writeFile, gitHeadFile } from "./ipc";
import { modalConfirm } from "./ui";
import { addTab, activateKey, requestClose, getActive, hasTab } from "./tabs";
import { activeProject } from "./projects";

// Only the base editor worker: no language services, so no TS/CSS/HTML
// intellisense workers to ship. Syntax highlighting is worker-free.
self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

monaco.editor.setTheme("vs-dark");

type EditorRec = {
  key: string;
  kind: "file" | "diff";
  projectId: string;
  root: string; // the owning project's root
  path: string; // absolute for files, root-relative for diffs
  title: string;
  setTitle(text: string): void;
  editor: monaco.editor.IStandaloneCodeEditor | monaco.editor.IStandaloneDiffEditor;
  lastDisk: string; // last content seen on disk, to detect external changes
  dirty: boolean;
};

const editors = new Map<string, EditorRec>();

function langFor(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "plaintext";
  const ext = path.slice(dot).toLowerCase();
  for (const l of monaco.languages.getLanguages()) {
    if (l.extensions?.includes(ext)) return l.id;
  }
  return "plaintext";
}

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

function labelText(rec: EditorRec): string {
  const prefix = rec.kind === "diff" ? "⇆ " : "";
  return (rec.dirty ? "● " : "") + prefix + rec.title;
}

function markDirty(rec: EditorRec, dirty: boolean) {
  if (rec.dirty === dirty) return;
  rec.dirty = dirty;
  rec.setTitle(labelText(rec));
}

function registerTab(rec: EditorRec): ReturnType<typeof addTab> {
  return addTab({
    key: rec.key,
    title: labelText(rec),
    kind: rec.kind,
    projectId: rec.projectId,
    onShow: () => {
      rec.editor.layout();
      rec.editor.focus();
    },
    onCloseRequest: async () =>
      !rec.dirty ||
      modalConfirm(`"${rec.title}" has unsaved changes. Close anyway?`),
    onClosed: () => {
      rec.editor.dispose();
      editors.delete(rec.key);
    },
  });
}

export async function openFile(absPath: string) {
  const project = activeProject();
  const key = `file:${project.id}:${absPath}`;
  if (hasTab(key)) return activateKey(key);

  const content = await readFile(absPath);
  const rec: EditorRec = {
    key,
    kind: "file",
    projectId: project.id,
    root: project.root,
    path: absPath,
    title: basename(absPath),
    setTitle: () => {},
    editor: undefined as unknown as EditorRec["editor"],
    lastDisk: content,
    dirty: false,
  };
  const handle = registerTab(rec);
  rec.setTitle = (t) => handle.setTitle(t);
  editors.set(key, rec);

  const editor = monaco.editor.create(handle.pane, {
    value: content,
    language: langFor(absPath),
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
  });
  rec.editor = editor;

  editor.onDidChangeModelContent(() => {
    markDirty(rec, editor.getValue() !== rec.lastDisk);
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    void saveTab(rec);
  });
  activateKey(key);
}

export async function openDiff(relPath: string) {
  const project = activeProject();
  const key = `diff:${project.id}:${relPath}`;
  if (hasTab(key)) {
    activateKey(key);
    const rec = editors.get(key);
    if (rec) await refreshDiff(rec);
    return;
  }

  const absPath = `${project.root}/${relPath}`;
  const [original, modified] = await Promise.all([
    gitHeadFile(project.root, relPath),
    readFile(absPath).catch(() => ""),
  ]);

  const rec: EditorRec = {
    key,
    kind: "diff",
    projectId: project.id,
    root: project.root,
    path: relPath,
    title: basename(relPath),
    setTitle: () => {},
    editor: undefined as unknown as EditorRec["editor"],
    lastDisk: modified,
    dirty: false,
  };
  const handle = registerTab(rec);
  rec.setTitle = (t) => handle.setTitle(t);
  editors.set(key, rec);

  const editor = monaco.editor.createDiffEditor(handle.pane, {
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    originalEditable: false,
    readOnly: false,
    renderSideBySide: true,
  });
  const lang = langFor(relPath);
  editor.setModel({
    original: monaco.editor.createModel(original, lang),
    modified: monaco.editor.createModel(modified, lang),
  });
  rec.editor = editor;

  const modifiedEditor = editor.getModifiedEditor();
  modifiedEditor.onDidChangeModelContent(() => {
    markDirty(rec, modifiedEditor.getValue() !== rec.lastDisk);
  });
  modifiedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    void saveTab(rec);
  });
  activateKey(key);
}

async function saveTab(rec: EditorRec) {
  const absPath = rec.kind === "diff" ? `${rec.root}/${rec.path}` : rec.path;
  const value =
    rec.kind === "diff"
      ? (rec.editor as monaco.editor.IStandaloneDiffEditor)
          .getModifiedEditor()
          .getValue()
      : (rec.editor as monaco.editor.IStandaloneCodeEditor).getValue();
  await writeFile(absPath, value);
  rec.lastDisk = value;
  markDirty(rec, false);
}

async function refreshDiff(rec: EditorRec) {
  const diffEditor = rec.editor as monaco.editor.IStandaloneDiffEditor;
  const model = diffEditor.getModel();
  if (!model) return;
  const absPath = `${rec.root}/${rec.path}`;
  const [original, modified] = await Promise.all([
    gitHeadFile(rec.root, rec.path),
    readFile(absPath).catch(() => ""),
  ]);
  if (model.original.getValue() !== original) {
    model.original.setValue(original);
  }
  // Only follow the disk if the user has no unsaved edits in the pane.
  if (!rec.dirty && modified !== rec.lastDisk) {
    model.modified.setValue(modified);
    rec.lastDisk = modified;
  }
}

// Force-close tabs for a renamed or deleted file/folder (absolute path).
export function closeTabsUnder(absPath: string) {
  for (const rec of [...editors.values()]) {
    const tabAbs = rec.kind === "diff" ? `${rec.root}/${rec.path}` : rec.path;
    if (tabAbs === absPath || tabAbs.startsWith(absPath + "/")) {
      void requestClose(rec.key, true);
    }
  }
}

// Poll hook: keep the visible diff in sync while Claude edits files.
export async function refreshActiveIfDiff() {
  const a = getActive();
  if (a?.kind !== "diff") return;
  const rec = editors.get(a.key);
  if (rec) await refreshDiff(rec);
}
