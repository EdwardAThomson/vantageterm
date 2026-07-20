import {
  initTerminals,
  ensureTerminal,
  typeIntoActiveTerminal,
  getActiveTerminalSelection,
} from "./term";
import { initStt } from "./stt";
import { initTts } from "./tts";
import { initTree, showProject } from "./tree";
import { initSplitters } from "./splitters";
import { activateLastTerminal } from "./tabs";
import { initProjects, type Project } from "./projects";
import { refreshChanges } from "./changes";

// Projects that have had their first terminal auto-opened, so switching back
// doesn't spawn a second one.
const seeded = new Set<string>();

async function enterProject(p: Project) {
  await showProject(p.root);
  await refreshChanges(true);
  if (!seeded.has(p.id)) {
    seeded.add(p.id);
    await ensureTerminal();
  }
}

async function start() {
  initSplitters();
  initTree();
  await initTerminals();

  addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "`") {
      e.preventDefault();
      activateLastTerminal();
    }
  });

  // initProjects seeds the rail and returns the project to open first; it does
  // not fire the switch handler for that initial one, so we enter it manually.
  const active = await initProjects((p) => void enterProject(p));
  await enterProject(active);

  // Each injects a button only if the backend was built with the matching
  // feature (--features stt / tts) and a model is present; otherwise no-ops.
  // Sequenced so the voice and speak buttons land in a stable DOM order.
  void initStt(typeIntoActiveTerminal).then(() =>
    initTts(getActiveTerminalSelection),
  );

  setInterval(() => void refreshChanges(), 2500);
}

void start();
