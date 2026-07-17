// Minimal modal dialogs. The webview's native prompt()/confirm() are not
// reliably implemented by wry/WebKitGTK, so we roll our own.

function buildOverlay(): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const box = document.createElement("div");
  box.className = "modal-box";
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  return box;
}

export function modalPrompt(title: string, initial = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const box = buildOverlay();
    const overlay = box.parentElement!;

    const label = document.createElement("div");
    label.className = "modal-title";
    label.textContent = title;

    const input = document.createElement("input");
    input.className = "modal-input";
    input.value = initial;

    const row = document.createElement("div");
    row.className = "modal-buttons";
    const ok = document.createElement("button");
    ok.textContent = "OK";
    ok.className = "modal-ok";
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    row.append(cancel, ok);

    box.append(label, input, row);

    const done = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };
    ok.addEventListener("click", () => done(input.value.trim() || null));
    cancel.addEventListener("click", () => done(null));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(input.value.trim() || null);
      if (e.key === "Escape") done(null);
    });
    input.focus();
    input.select();
  });
}

export function modalConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const box = buildOverlay();
    const overlay = box.parentElement!;

    const label = document.createElement("div");
    label.className = "modal-title";
    label.textContent = message;

    const row = document.createElement("div");
    row.className = "modal-buttons";
    const ok = document.createElement("button");
    ok.textContent = "OK";
    ok.className = "modal-ok";
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    row.append(cancel, ok);

    box.append(label, row);

    const done = (value: boolean) => {
      overlay.remove();
      resolve(value);
    };
    ok.addEventListener("click", () => done(true));
    cancel.addEventListener("click", () => done(false));
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") done(false);
    });
    ok.focus();
  });
}

// Simple context menu: items with handlers, dismissed on any outside click.
export function showContextMenu(
  x: number,
  y: number,
  items: { label: string; action: () => void }[],
) {
  document.querySelector(".context-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  for (const item of items) {
    const el = document.createElement("div");
    el.className = "context-menu-item";
    el.textContent = item.label;
    el.addEventListener("click", () => {
      menu.remove();
      item.action();
    });
    menu.appendChild(el);
  }
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);

  // Keep the menu on-screen.
  const rect = menu.getBoundingClientRect();
  if (rect.right > innerWidth) menu.style.left = `${innerWidth - rect.width - 4}px`;
  if (rect.bottom > innerHeight) menu.style.top = `${innerHeight - rect.height - 4}px`;

  const dismiss = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      removeEventListener("mousedown", dismiss, true);
    }
  };
  addEventListener("mousedown", dismiss, true);
}
