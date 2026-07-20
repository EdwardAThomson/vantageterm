import {
  listDir,
  createFile,
  createDir,
  renamePath,
  deletePath,
  type DirEntry,
  type GitChange,
} from "./ipc";
import { openFile, closeTabsUnder } from "./editors";
import { modalPrompt, modalConfirm, showContextMenu } from "./ui";

const treeEl = document.getElementById("tree")!;
let rootPath = "";
// workspace-relative path -> porcelain XY status (for the active project)
let statusByPath = new Map<string, string>();
// expanded directories, kept per project root so each remembers its shape
const expandedByRoot = new Map<string, Set<string>>();
let selectedLabel: HTMLElement | null = null;
// Whether dotfiles (.env, .gitignore, …) are shown in the tree; remembered.
let showHidden = localStorage.getItem("showHidden") === "1";

function expanded(): Set<string> {
  let s = expandedByRoot.get(rootPath);
  if (!s) {
    s = new Set();
    expandedByRoot.set(rootPath, s);
  }
  return s;
}

function relOf(absPath: string): string {
  return absPath.startsWith(rootPath + "/") ? absPath.slice(rootPath.length + 1) : absPath;
}

function gitClass(status: string | undefined): string {
  if (!status) return "";
  if (status.includes("D")) return "git-deleted";
  if (status.includes("?") || status.includes("A")) return "git-added";
  return "git-modified";
}

// Signature of each directory's rendered listing, so the poll can tell whether
// anything actually changed before touching the DOM.
const renderedSig = new Map<string, string>();

function sigOf(entries: DirEntry[]): string {
  const parts: string[] = [];
  for (const e of entries) {
    if (!showHidden && e.name.startsWith(".")) continue;
    parts.push(`${e.is_dir ? "d" : "f"}:${e.name}`);
  }
  return parts.join("\n");
}

async function renderChildren(
  container: HTMLElement,
  dirPath: string,
  entries?: DirEntry[],
) {
  if (!entries) {
    try {
      entries = await listDir(dirPath);
    } catch {
      return;
    }
  }
  renderedSig.set(dirPath, sigOf(entries));
  container.textContent = "";
  for (const entry of entries) {
    if (!showHidden && entry.name.startsWith(".")) continue;
    container.appendChild(nodeFor(entry));
  }
}

async function newFileIn(dirPath: string) {
  const name = await modalPrompt("New file name");
  if (!name) return;
  const path = `${dirPath}/${name}`;
  try {
    await createFile(path);
  } catch (e) {
    await modalConfirm(`Could not create file: ${e}`);
    return;
  }
  expanded().add(dirPath);
  await refreshTree();
  void openFile(path);
}

async function newFolderIn(dirPath: string) {
  const name = await modalPrompt("New folder name");
  if (!name) return;
  try {
    await createDir(`${dirPath}/${name}`);
  } catch (e) {
    await modalConfirm(`Could not create folder: ${e}`);
    return;
  }
  expanded().add(dirPath);
  await refreshTree();
}

async function renameEntry(entry: DirEntry) {
  const name = await modalPrompt(`Rename "${entry.name}"`, entry.name);
  if (!name || name === entry.name) return;
  const parent = entry.path.slice(0, entry.path.length - entry.name.length - 1);
  try {
    await renamePath(entry.path, `${parent}/${name}`);
  } catch (e) {
    await modalConfirm(`Could not rename: ${e}`);
    return;
  }
  closeTabsUnder(entry.path);
  await refreshTree();
}

async function deleteEntry(entry: DirEntry) {
  const kind = entry.is_dir ? "folder (and everything in it)" : "file";
  if (!(await modalConfirm(`Delete ${kind} "${entry.name}"?`))) return;
  try {
    await deletePath(entry.path);
  } catch (e) {
    await modalConfirm(`Could not delete: ${e}`);
    return;
  }
  closeTabsUnder(entry.path);
  await refreshTree();
}

function menuFor(entry: DirEntry): { label: string; action: () => void }[] {
  if (entry.is_dir) {
    return [
      { label: "New File…", action: () => void newFileIn(entry.path) },
      { label: "New Folder…", action: () => void newFolderIn(entry.path) },
      { label: "Rename…", action: () => void renameEntry(entry) },
      { label: "Delete", action: () => void deleteEntry(entry) },
    ];
  }
  return [
    { label: "Open", action: () => void openFile(entry.path) },
    { label: "Rename…", action: () => void renameEntry(entry) },
    { label: "Delete", action: () => void deleteEntry(entry) },
  ];
}

function nodeFor(entry: DirEntry): HTMLElement {
  const node = document.createElement("div");
  node.className = "tree-node";

  const label = document.createElement("div");
  label.className = "tree-label";
  label.dataset.path = entry.path;
  if (!entry.is_dir) label.dataset.file = "1";

  const caret = document.createElement("span");
  caret.className = "tree-caret";
  caret.textContent = entry.is_dir ? (expanded().has(entry.path) ? "▾" : "▸") : "";

  const name = document.createElement("span");
  name.textContent = entry.name;

  label.append(caret, name);
  node.appendChild(label);

  if (!entry.is_dir) {
    const cls = gitClass(statusByPath.get(relOf(entry.path)));
    if (cls) label.classList.add(cls);
  }

  const children = document.createElement("div");
  children.className = "tree-children";
  node.appendChild(children);

  if (entry.is_dir && expanded().has(entry.path)) {
    void renderChildren(children, entry.path);
  }

  label.addEventListener("click", () => {
    selectedLabel?.classList.remove("selected");
    label.classList.add("selected");
    selectedLabel = label;
    if (entry.is_dir) {
      if (expanded().has(entry.path)) {
        expanded().delete(entry.path);
        caret.textContent = "▸";
        children.textContent = "";
      } else {
        expanded().add(entry.path);
        caret.textContent = "▾";
        void renderChildren(children, entry.path);
      }
    } else {
      void openFile(entry.path);
    }
  });

  label.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, menuFor(entry));
  });

  return node;
}

// One-time wiring shared across all projects.
export function initTree() {
  // Right-click on empty tree space targets the active project's root.
  treeEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { label: "New File…", action: () => void newFileIn(rootPath) },
      { label: "New Folder…", action: () => void newFolderIn(rootPath) },
    ]);
  });

  document
    .getElementById("new-file-btn")!
    .addEventListener("click", () => void newFileIn(rootPath));

  const hiddenBtn = document.getElementById("toggle-hidden")!;
  const syncHiddenBtn = () => {
    hiddenBtn.classList.toggle("active", showHidden);
    hiddenBtn.title = showHidden
      ? "Hide dotfiles (.env, .gitignore, …)"
      : "Show dotfiles (.env, .gitignore, …)";
  };
  syncHiddenBtn();
  hiddenBtn.addEventListener("click", () => {
    showHidden = !showHidden;
    localStorage.setItem("showHidden", showHidden ? "1" : "0");
    syncHiddenBtn();
    void refreshTree();
  });
}

// Point the tree at a project root and render it. Called on launch and on each
// project switch; expansion state is remembered per root.
export async function showProject(root: string) {
  rootPath = root;
  statusByPath = new Map();
  selectedLabel = null;
  await renderChildren(treeEl, root);
}

export function applyGitStatus(changes: GitChange[]) {
  statusByPath = new Map(changes.map((c) => [c.path, c.status]));
  // Recolor visible file labels in place; no re-render, so expansion
  // state and scroll position are untouched.
  for (const label of treeEl.querySelectorAll<HTMLElement>(".tree-label[data-file]")) {
    label.classList.remove("git-modified", "git-added", "git-deleted");
    const cls = gitClass(statusByPath.get(relOf(label.dataset.path!)));
    if (cls) label.classList.add(cls);
  }
}

export async function refreshTree() {
  await renderChildren(treeEl, rootPath);
}

let pollBusy = false;

// Called on the shared 2.5s poll: pick up files created, renamed, or deleted
// outside the app (agents, shells) by re-listing the root and every expanded
// directory. Only directories whose visible contents changed are re-rendered,
// so scroll position, expansion, and selection are untouched on quiet ticks.
export async function pollTree() {
  if (pollBusy || !rootPath) return;
  pollBusy = true;
  try {
    // Parents first (shorter paths), so a re-rendered directory lets us skip
    // its descendants: renderChildren already rebuilt them fresh.
    const dirs = [rootPath, ...expanded()].sort((a, b) => a.length - b.length);
    const redone: string[] = [];
    for (const dir of dirs) {
      if (redone.some((d) => dir.startsWith(d + "/"))) continue;
      const container =
        dir === rootPath
          ? treeEl
          : (treeEl.querySelector(`.tree-label[data-path="${CSS.escape(dir)}"]`)
              ?.nextElementSibling as HTMLElement | null);
      if (!container) continue; // expanded but not visible (ancestor collapsed)
      let entries: DirEntry[];
      try {
        entries = await listDir(dir);
      } catch {
        continue; // e.g. directory vanished; its parent's diff handles it
      }
      if (sigOf(entries) === renderedSig.get(dir)) continue;
      const selPath = selectedLabel?.dataset.path;
      await renderChildren(container, dir, entries);
      redone.push(dir);
      if (selPath) {
        selectedLabel = treeEl.querySelector<HTMLElement>(
          `.tree-label[data-path="${CSS.escape(selPath)}"]`,
        );
        selectedLabel?.classList.add("selected");
      }
    }
  } finally {
    pollBusy = false;
  }
}
