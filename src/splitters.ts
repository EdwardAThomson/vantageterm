import { refitTerminals } from "./term";

const app = document.getElementById("app")!;
const vSplit = document.getElementById("splitter-v")!;
const RAIL = 48; // fixed project-rail column to the left of the sidebar

function applySidebarWidth(w: number) {
  app.style.gridTemplateColumns = `${RAIL}px ${w}px 4px 1fr`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function initSplitters() {
  const savedW = Number(localStorage.getItem("sidebarWidth"));
  if (savedW) applySidebarWidth(savedW);

  vSplit.addEventListener("pointerdown", (down) => {
    down.preventDefault();
    vSplit.setPointerCapture(down.pointerId);
    const widthFor = (e: PointerEvent) => clamp(e.clientX - RAIL, 150, innerWidth - 400);
    const move = (e: PointerEvent) => applySidebarWidth(widthFor(e));
    const up = (e: PointerEvent) => {
      localStorage.setItem("sidebarWidth", String(widthFor(e)));
      vSplit.removeEventListener("pointermove", move);
      vSplit.removeEventListener("pointerup", up);
      refitTerminals();
    };
    vSplit.addEventListener("pointermove", move);
    vSplit.addEventListener("pointerup", up);
  });
}
