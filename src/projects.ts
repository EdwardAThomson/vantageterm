import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { workspaceRoot, canonicalize } from "./ipc";
import { setActiveProject, closeProjectTabs } from "./tabs";
import { modalConfirm, showContextMenu } from "./ui";

export interface Project {
  id: string;
  root: string;
  name: string;
}

let projects: Project[] = [];
let activeId = "";
let counter = 0;
let onSwitch: (p: Project) => void = () => {};

const rail = document.getElementById("project-rail")!;
const addBtn = document.getElementById("add-project")!;
const rootNameEl = document.getElementById("root-name")!;

function nameOf(root: string): string {
  return root.split("/").filter(Boolean).pop() || root;
}

function tile(name: string): string {
  // Two-letter initials for the rail tile.
  const parts = name.replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function activeProject(): Project {
  return projects.find((p) => p.id === activeId)!;
}
export function activeProjectId(): string {
  return activeId;
}
export function activeRoot(): string {
  return activeProject().root;
}

function persist() {
  localStorage.setItem(
    "projects",
    JSON.stringify(projects.map((p) => ({ root: p.root, name: p.name }))),
  );
  localStorage.setItem("activeProjectRoot", activeProject()?.root ?? "");
}

function renderRail() {
  rail.querySelectorAll(".proj-tile").forEach((el) => el.remove());
  for (const p of projects) {
    const el = document.createElement("button");
    el.className = "proj-tile" + (p.id === activeId ? " active" : "");
    el.textContent = tile(p.name);
    el.title = p.name + "\n" + p.root;
    el.addEventListener("click", () => switchTo(p.id));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: "Remove from rail", action: () => void removeProject(p.id) },
      ]);
    });
    rail.insertBefore(el, addBtn);
  }
}

export function switchTo(id: string) {
  const p = projects.find((x) => x.id === id);
  if (!p) return;
  activeId = id;
  setActiveProject(id);
  rootNameEl.textContent = p.name;
  rootNameEl.title = p.root;
  renderRail();
  persist();
  onSwitch(p);
}

function addProject(root: string): Project {
  const existing = projects.find((p) => p.root === root);
  if (existing) return existing;
  counter += 1;
  const p: Project = { id: `p${counter}`, root, name: nameOf(root) };
  projects.push(p);
  renderRail();
  persist();
  return p;
}

async function removeProject(id: string) {
  if (projects.length === 1) {
    await modalConfirm("Can't remove the last project.");
    return;
  }
  const p = projects.find((x) => x.id === id);
  if (!p) return;
  if (!(await modalConfirm(`Remove "${p.name}" from the rail? Its terminals will close.`)))
    return;
  await closeProjectTabs(id);
  projects = projects.filter((x) => x.id !== id);
  if (activeId === id) {
    switchTo(projects[0].id);
  } else {
    renderRail();
    persist();
  }
}

export async function openFolder() {
  const picked = await openDialog({ directory: true, multiple: false });
  if (typeof picked !== "string") return;
  let root = picked;
  try {
    root = await canonicalize(picked);
  } catch {
    // keep the raw path if canonicalize fails
  }
  const p = addProject(root);
  switchTo(p.id);
}

// Seed the rail and return the project that should be active on launch. The
// caller wires up the rest (tree, git, first terminal) for that project.
export async function initProjects(handler: (p: Project) => void): Promise<Project> {
  onSwitch = handler;
  addBtn.addEventListener("click", () => void openFolder());

  const launch = await workspaceRoot();
  let saved: { root: string }[] = [];
  try {
    saved = JSON.parse(localStorage.getItem("projects") || "[]");
  } catch {
    saved = [];
  }
  addProject(launch);
  for (const s of saved) if (s.root !== launch) addProject(s.root);

  const savedActive = localStorage.getItem("activeProjectRoot");
  const active =
    projects.find((p) => p.root === savedActive) ??
    projects.find((p) => p.root === launch)!;
  activeId = active.id;
  setActiveProject(activeId);
  rootNameEl.textContent = active.name;
  rootNameEl.title = active.root;
  renderRail();
  return active;
}
