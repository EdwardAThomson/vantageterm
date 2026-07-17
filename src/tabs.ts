// Two-level tabs, scoped per project. A category bar (Terminal | Files) sits
// above a per-category sub-tab strip. Every tab also belongs to a project, and
// only the active project's tabs are shown; the rest keep running hidden, so
// switching projects in the rail preserves each one's terminals and open files.

import { modalPrompt, showContextMenu } from "./ui";

export type TabKind = "term" | "file" | "diff";
type Category = "term" | "files";

const catOf = (kind: TabKind): Category => (kind === "term" ? "term" : "files");

export interface TabHandle {
  key: string;
  kind: TabKind;
  pane: HTMLElement;
  setTitle(text: string): void;
}

interface TabRecord extends TabHandle {
  projectId: string;
  tabEl: HTMLElement;
  labelEl: HTMLElement;
  onShow?: () => void;
  onCloseRequest?: () => Promise<boolean> | boolean;
  onClosed?: () => void;
}

// Per-project view state: which category is showing and the active/MRU tab
// within each category.
interface ProjView {
  category: Category;
  activeByCat: Record<Category, string | null>;
  mru: Record<Category, string[]>;
}

const registry = new Map<string, TabRecord>();
const projViews = new Map<string, ProjView>();
let activeProjectId = "";

const catTermBtn = document.getElementById("cat-term")!;
const catFilesBtn = document.getElementById("cat-files")!;
const stripTerm = document.getElementById("subtabs-term")!;
const stripFiles = document.getElementById("subtabs-files")!;
const panes = document.getElementById("panes")!;
const emptyState = document.getElementById("empty-state")!;
const newTermBtn = document.getElementById("new-term")!;

catTermBtn.addEventListener("click", () => setCategory("term"));
catFilesBtn.addEventListener("click", () => setCategory("files"));

function viewFor(pid: string): ProjView {
  let v = projViews.get(pid);
  if (!v) {
    v = {
      category: "term",
      activeByCat: { term: null, files: null },
      mru: { term: [], files: [] },
    };
    projViews.set(pid, v);
  }
  return v;
}

export function setActiveProject(pid: string) {
  activeProjectId = pid;
  viewFor(pid);
  refreshView();
}

export function getActive(): TabHandle | null {
  const v = viewFor(activeProjectId);
  const key = v.activeByCat[v.category];
  return key ? (registry.get(key) ?? null) : null;
}

export function hasTab(key: string): boolean {
  return registry.has(key);
}

function setCategory(cat: Category) {
  viewFor(activeProjectId).category = cat;
  refreshView();
}

function refreshView() {
  const v = viewFor(activeProjectId);
  const cat = v.category;
  stripTerm.classList.toggle("hidden", cat !== "term");
  stripFiles.classList.toggle("hidden", cat !== "files");
  catTermBtn.classList.toggle("active", cat === "term");
  catFilesBtn.classList.toggle("active", cat === "files");

  const activeKey = v.activeByCat[cat];
  for (const r of registry.values()) {
    const mine = r.projectId === activeProjectId;
    r.tabEl.classList.toggle("hidden", !mine);
    r.pane.classList.toggle("hidden", r.key !== activeKey);
    r.tabEl.classList.toggle(
      "active",
      mine && r.key === v.activeByCat[catOf(r.kind)],
    );
  }

  if (activeKey) {
    emptyState.style.display = "none";
    registry.get(activeKey)?.onShow?.();
  } else {
    emptyState.textContent =
      cat === "term"
        ? "No terminals here. Press + to open one."
        : "Click a file or a change in the sidebar to view it here.";
    emptyState.style.display = "flex";
  }
}

export function addTab(opts: {
  key: string;
  title: string;
  kind: TabKind;
  projectId: string;
  renamable?: boolean;
  onShow?: () => void;
  onCloseRequest?: () => Promise<boolean> | boolean;
  onClosed?: () => void;
}): TabHandle {
  const pane = document.createElement("div");
  pane.className = `tab-pane ${opts.kind}-pane hidden`;
  panes.appendChild(pane);

  const tabEl = document.createElement("div");
  tabEl.className = "tab";
  const labelEl = document.createElement("span");
  labelEl.className = "tab-label";
  labelEl.textContent = opts.title;
  const closeBtn = document.createElement("button");
  closeBtn.className = "close";
  closeBtn.textContent = "✕";
  tabEl.append(labelEl, closeBtn);
  if (catOf(opts.kind) === "term") stripTerm.insertBefore(tabEl, newTermBtn);
  else stripFiles.appendChild(tabEl);

  const rec: TabRecord = {
    key: opts.key,
    kind: opts.kind,
    projectId: opts.projectId,
    pane,
    tabEl,
    labelEl,
    onShow: opts.onShow,
    onCloseRequest: opts.onCloseRequest,
    onClosed: opts.onClosed,
    setTitle: (text: string) => {
      labelEl.textContent = text;
    },
  };
  registry.set(opts.key, rec);

  tabEl.addEventListener("click", (e) => {
    if (e.target === closeBtn) return;
    activateKey(opts.key);
  });
  closeBtn.addEventListener("click", () => void requestClose(opts.key));

  tabEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const items: { label: string; action: () => void }[] = [];
    if (opts.renamable) {
      items.push({
        label: "Rename…",
        action: async () => {
          const name = await modalPrompt("Rename tab", labelEl.textContent ?? "");
          if (name) labelEl.textContent = name;
        },
      });
    }
    items.push({ label: "Close", action: () => void requestClose(opts.key) });
    showContextMenu(e.clientX, e.clientY, items);
  });
  return rec;
}

export function activateKey(key: string) {
  const rec = registry.get(key);
  if (!rec) return;
  const v = viewFor(rec.projectId);
  const cat = catOf(rec.kind);
  v.category = cat;
  v.activeByCat[cat] = key;
  const list = v.mru[cat];
  const i = list.indexOf(key);
  if (i >= 0) list.splice(i, 1);
  list.unshift(key);
  if (rec.projectId === activeProjectId) {
    refreshView();
    rec.tabEl.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

export async function requestClose(key: string, force = false) {
  const rec = registry.get(key);
  if (!rec) return;
  if (!force && rec.onCloseRequest) {
    const ok = await rec.onCloseRequest();
    if (!ok) return;
  }
  rec.onClosed?.();
  rec.pane.remove();
  rec.tabEl.remove();
  registry.delete(key);

  const v = viewFor(rec.projectId);
  const cat = catOf(rec.kind);
  const list = v.mru[cat];
  const i = list.indexOf(key);
  if (i >= 0) list.splice(i, 1);
  if (v.activeByCat[cat] === key) {
    v.activeByCat[cat] = list[0] ?? null;
  }
  if (rec.projectId === activeProjectId) refreshView();
}

// Force-close every tab belonging to a project (used when removing it from the
// rail); onClosed handlers kill ptys and dispose editors.
export async function closeProjectTabs(pid: string) {
  for (const rec of [...registry.values()]) {
    if (rec.projectId === pid) await requestClose(rec.key, true);
  }
  projViews.delete(pid);
}

// Flip the active project to its Terminal category (Ctrl+`).
export function activateLastTerminal() {
  setCategory("term");
}
