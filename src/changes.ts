import { gitStatus, type GitChange } from "./ipc";
import { applyGitStatus } from "./tree";
import { openDiff, refreshActiveIfDiff } from "./editors";
import { activeRoot } from "./projects";

const changesEl = document.getElementById("changes")!;
let lastKey = "";

function render(changes: GitChange[]) {
  changesEl.textContent = "";
  if (!changes.length) {
    const div = document.createElement("div");
    div.className = "changes-empty";
    div.textContent = "no changes";
    changesEl.appendChild(div);
    return;
  }
  for (const change of changes) {
    const row = document.createElement("div");
    row.className = "change-row";
    row.title = `${change.status} ${change.path}`;

    const status = document.createElement("span");
    status.className = "change-status";
    const code = change.status.trim()[0] ?? "M";
    status.textContent = code === "?" ? "U" : code;
    status.style.color =
      code === "D"
        ? "var(--git-deleted)"
        : code === "?" || code === "A"
          ? "var(--git-added)"
          : "var(--git-modified)";

    const name = document.createElement("span");
    name.className = "change-name";
    name.textContent = change.path.split("/").pop() ?? change.path;

    const dir = document.createElement("span");
    dir.className = "change-dir";
    dir.textContent = change.path.split("/").slice(0, -1).join("/");

    row.append(status, name, dir);
    row.addEventListener("click", () => void openDiff(change.path));
    changesEl.appendChild(row);
  }
}

// Poll the active project's git status and update the changes list, the tree
// decorations, and any visible diff. The list/tree work is skipped when the
// status is unchanged (the common case between edits), so the 2.5s poll doesn't
// churn the DOM; a project switch forces it since the repo is different.
export async function refreshChanges(projectSwitched = false) {
  try {
    const changes = await gitStatus(activeRoot());
    const key = changes.map((c) => c.status + c.path).join("\n");
    if (projectSwitched || key !== lastKey) {
      lastKey = key;
      render(changes);
      applyGitStatus(changes);
    }
    await refreshActiveIfDiff();
  } catch {
    // Git briefly unavailable (e.g. mid index write) is fine; next tick.
  }
}
