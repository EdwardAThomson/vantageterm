import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { CanvasAddon } from "@xterm/addon-canvas";
import "@xterm/xterm/css/xterm.css";
import { listen } from "@tauri-apps/api/event";
import { ptySpawn, ptyWrite, ptyResize, ptyKill } from "./ipc";
import { addTab, activateKey, getActive } from "./tabs";
import { activeProject } from "./projects";

interface TermRec {
  key: string;
  ptyId: number;
  term: Terminal;
  fit: FitAddon;
  pane: HTMLElement;
  exited: boolean;
}

const terms = new Map<string, TermRec>();
// Direct pty-id -> record lookup so streaming output doesn't scan every tab.
const termsByPty = new Map<number, TermRec>();
let counter = 0;

export async function initTerminals() {
  await listen<{ id: number; data: number[] }>("pty-output", (e) => {
    termsByPty.get(e.payload.id)?.term.write(new Uint8Array(e.payload.data));
  });
  await listen<number>("pty-exit", (e) => {
    const rec = termsByPty.get(e.payload);
    if (rec && !rec.exited) {
      rec.exited = true;
      rec.term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
    }
  });

  document
    .getElementById("new-term")!
    .addEventListener("click", () => void createTerminal());
  window.addEventListener("resize", () => refitTerminals());
}

// Open a terminal in the active project if it has none yet (used on launch and
// when switching to a project that has never been visited).
export async function ensureTerminal() {
  await createTerminal();
}

// Fit the terminal in the active tab, if the active tab is a terminal.
export function refitTerminals() {
  const a = getActive();
  if (!a || a.kind !== "term") return;
  const rec = terms.get(a.key);
  if (!rec || rec.pane.offsetHeight === 0) return;
  rec.fit.fit();
  void ptyResize(rec.ptyId, rec.term.cols, rec.term.rows);
}

// Write text to the active terminal's shell (used by voice input). Only acts
// when the foreground tab is a terminal, so text can't land in a hidden shell.
export function typeIntoActiveTerminal(text: string) {
  const a = getActive();
  if (!a || a.kind !== "term") return;
  const rec = terms.get(a.key);
  if (rec) void ptyWrite(rec.ptyId, text);
}

// Selected text in the active terminal (used by speech output). Empty when the
// foreground tab isn't a terminal or nothing is selected.
export function getActiveTerminalSelection(): string {
  const a = getActive();
  if (!a || a.kind !== "term") return "";
  return terms.get(a.key)?.term.getSelection() ?? "";
}

function loadRenderer(term: Terminal) {
  // xterm's default DOM renderer builds a large DOM subtree per terminal, so
  // many open terminals get sluggish to switch between. The 2D canvas renderer
  // draws each terminal to a single canvas instead, which is reliable under
  // WebKitGTK. If it can't initialize, xterm keeps its built-in DOM renderer.
  try {
    term.loadAddon(new CanvasAddon());
  } catch {
    // fall back to the built-in DOM renderer
  }
}

// iTerm2-style Alt-click to reposition the shell cursor: translate the clicked
// cell into a character delta from the current cursor and send that many left/
// right arrow keys, which readline/zsh understand. Uses only horizontal arrows
// (computed across wrapped rows) so it never triggers command history the way
// up/down would. Restricted to the normal buffer, so full-screen apps like vim
// and htop (alternate screen, their own mouse handling) are left alone.
function enableAltClickToMove(term: Terminal, ptyId: number) {
  const el = term.element;
  if (!el) return;
  el.addEventListener("mousedown", (e) => {
    if (!e.altKey || e.button !== 0) return;
    if (term.buffer.active.type !== "normal") return;
    const screen = el.querySelector(".xterm-screen") as HTMLElement | null;
    if (!screen) return;
    const rect = screen.getBoundingClientRect();
    const cellW = rect.width / term.cols;
    const cellH = rect.height / term.rows;
    if (!cellW || !cellH) return;

    const col = Math.max(
      0,
      Math.min(term.cols - 1, Math.floor((e.clientX - rect.left) / cellW)),
    );
    const row = Math.floor((e.clientY - rect.top) / cellH);
    const target = row * term.cols + col;
    const current =
      term.buffer.active.cursorY * term.cols + term.buffer.active.cursorX;
    const delta = target - current;
    if (delta === 0) return;

    e.preventDefault();
    const arrow = delta > 0 ? "\x1b[C" : "\x1b[D";
    void ptyWrite(ptyId, arrow.repeat(Math.abs(delta)));
  });
}

async function createTerminal() {
  counter += 1;
  const project = activeProject();
  const key = `term:${counter}`;
  const handle = addTab({
    key,
    title: `❯ term ${counter}`,
    kind: "term",
    projectId: project.id,
    renamable: true,
    onShow: () => {
      // Fit after the pane becomes visible, then focus so keys go to the shell.
      requestAnimationFrame(() => {
        refitTerminals();
        terms.get(key)?.term.focus();
      });
    },
    onClosed: () => {
      const rec = terms.get(key);
      if (rec) {
        void ptyKill(rec.ptyId).catch(() => {});
        rec.term.dispose();
        terms.delete(key);
        termsByPty.delete(rec.ptyId);
      }
    },
  });

  // Activate first so the pane has real dimensions before xterm measures it.
  activateKey(key);

  const term = new Terminal({
    fontFamily: "monospace",
    fontSize: 14,
    scrollback: 10000,
    theme: { background: "#000000" },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(handle.pane);
  loadRenderer(term);
  fit.fit();

  const ptyId = await ptySpawn(project.root, term.cols, term.rows);
  term.onData((data) => void ptyWrite(ptyId, data));
  term.onResize(({ cols, rows }) => void ptyResize(ptyId, cols, rows));
  enableAltClickToMove(term, ptyId);

  const rec = { key, ptyId, term, fit, pane: handle.pane, exited: false };
  terms.set(key, rec);
  termsByPty.set(ptyId, rec);
  term.focus();
}
