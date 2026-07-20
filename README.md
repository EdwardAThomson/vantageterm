# VantageTerm

A lightweight desktop vantage point for working with Claude Code (or any CLI
agent): a multi-tab terminal, a file tree with git status, and VS Code-quality
file viewing and side-by-side diffs, without the weight of a full IDE.

![VantageTerm running a Claude Code session, with the project rail, git changes, and file tree alongside the terminal](docs/terminal.png)

The idea: keep your terminal front and center where the agent does its work,
and make reviewing what changed (files and diffs) a click away, across several
projects at once.

Built with **Tauri 2** (Rust backend), **xterm.js** (terminals), and
**Monaco** (the viewer and diff editor VS Code itself uses).

![Reviewing a change as a side-by-side diff in VantageTerm](docs/diff-review.png)

*Reviewing a change as a side-by-side diff — the Monaco diff editor, with the
git Changes list in the sidebar.*

## Features

- **Project rail** — open several projects at once; each keeps its own
  terminals and open files running while you're elsewhere. Switch with one
  click. Open projects are remembered between runs.
- **Multi-tab terminals** — real ptys running your shell in the project root.
  Rename a tab from its right-click menu. Rendered to a canvas for speed.
  Typing `exit` closes the tab; a shell that dies abnormally leaves the tab
  open so you can read what happened.
- **Alt-click to move the cursor** — hold Alt and click anywhere in a shell
  prompt to jump the cursor there (iTerm2-style), computed across wrapped lines
  so it never triggers command history. Full-screen apps like vim keep their
  own mouse handling.
- **File tree with git status** — yellow = modified, green = added/untracked,
  red = deleted. Right-click for New File / New Folder / Rename / Delete.
  The tree picks up files an agent creates or deletes within a few seconds,
  without disturbing scroll or expansion. A sidebar toggle shows or hides
  dotfiles, remembered between runs.
- **Changes list** — every modified file for the active project; click one to
  open its diff against `HEAD`.
- **File viewing and light editing** — full syntax highlighting via Monaco.
  `Ctrl+S` saves. No LSP, no project-wide search: this is a viewer, not an IDE.
- **Side-by-side diffs** — the VS Code diff editor. The open diff auto-refreshes
  as files change on disk, so you can watch an agent's edits land live.

## Layout

The main area uses two-level tabs: a category bar (**Terminal** | **Files**)
with the active category's sub-tabs beneath it. The far-left rail switches
projects; the sidebar holds the git changes list and file tree. Each project
remembers which category and tab it was on. `Ctrl+`` flips to the Terminal
category.

## Requirements

- [Rust](https://rustup.rs/) (stable) and Cargo
- [Node.js](https://nodejs.org/) 18+ and npm
- Linux: WebKitGTK 4.1 and the usual Tauri build deps — see the
  [Tauri prerequisites](https://tauri.app/start/prerequisites/)

## Development

```bash
npm install
npm run tauri dev            # opens your remembered projects
                             # (first run: the folder it was launched from)
```

## Build a standalone binary

For a fast-starting, self-contained app (no npm, no dev server), build in
release mode — Tauri embeds the frontend into the binary:

```bash
npm run tauri build                          # lean build
npm run tauri build -- --features stt        # include local voice input
npm run tauri build -- --features tts        # include local speech output
npm run tauri build -- --features stt,tts    # both
```

The binary lands at `src-tauri/target/release/vantageterm`.

## Install as a command

Put it on your `PATH` so `vantageterm` works from any directory:

```bash
ln -sf "$PWD/src-tauri/target/release/vantageterm" ~/.local/bin/vantageterm
```

(Make sure `~/.local/bin` is on your `PATH`.) Then:

```bash
vantageterm              # open the current directory as a project
vantageterm ~/some/repo  # open a specific folder
```

Because it's a symlink into `target/`, rebuilding picks up the new binary
automatically. Note that `cargo clean` removes the binary until you rebuild; for
a copy that survives cleans, use `cp` instead of `ln -sf`.

## Voice input (optional, fully local)

VantageTerm can transcribe speech into the active terminal so you can dictate to
a CLI agent. It's **off by default** and gated behind a Cargo feature, so the
normal build stays lean and pulls in no audio/ML dependencies. When enabled,
transcription runs entirely on your machine (whisper.cpp) — your audio never
leaves the device.

Enable it at build time:

```bash
# dev
npm run tauri dev -- --features stt
# release
npm run tauri build -- --features stt
```

You also need the Whisper model weights on disk (a one-time download of the
weights file, *not* your audio going anywhere). Place a `ggml-*.bin` model in:

```
~/.local/share/vantageterm/models/
```

Models are available from the whisper.cpp project (e.g. `ggml-base.en.bin`,
~140 MB). With the feature compiled and a model present, a **voice** button
appears in the terminal tab strip: click to record, click again to transcribe;
the text is typed into the active terminal for you to review.

Model weights are never committed to the repo (see `.gitignore`).

## Speech output (optional, fully local)

VantageTerm can also read terminal text aloud: select text in a terminal, click
the **speak** button in the tab strip, and a local [Piper](https://github.com/rhasspy/piper)
voice reads it; click again to stop mid-utterance. Like voice input, it's
**off by default** behind a Cargo feature, synthesis runs entirely on your
machine, and nothing leaves the device.

Enable it at build time (combines freely with `stt`):

```bash
# dev
npm run tauri dev -- --features tts
# release
npm run tauri build -- --features tts
```

You also need a Piper voice on disk: a pair of files, `<voice>.onnx` plus
`<voice>.onnx.json`, both placed in the same models directory as the Whisper
weights:

```
~/.local/share/vantageterm/models/
```

Voices are available from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices)
on Hugging Face; `en_US-lessac-medium` (~63 MB) is a good default:

```bash
cd ~/.local/share/vantageterm/models
base=https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium
curl -sSLO $base/en_US-lessac-medium.onnx
curl -sSLO $base/en_US-lessac-medium.onnx.json
```

Build notes for the `tts` feature: the Piper bindings generate espeak-ng
bindings at build time, which needs clang's builtin headers (`sudo apt install
libclang-dev`, or point bindgen at GCC's copy with
`BINDGEN_EXTRA_CLANG_ARGS=-I/usr/lib/gcc/x86_64-linux-gnu/13/include`), and the
onnxruntime backend downloads its prebuilt runtime during the first build, so
that build needs network access.

## Project structure

```
src/                     Frontend (vanilla TypeScript + Vite)
  main.ts                Bootstrap and wiring
  projects.ts            Project rail, switching, persistence
  tabs.ts                Two-level, per-project tab manager
  term.ts                xterm.js terminals over ptys
  editors.ts             Monaco file + diff editors
  tree.ts                File tree with git decorations and file ops
  changes.ts             Git changes list and polling
  splitters.ts           Sidebar resize
  ui.ts                  Modal prompts / confirms / context menus
  ipc.ts                 Typed wrappers over Tauri commands
  stt.ts                 Voice input UI (active only with the `stt` feature)
  tts.ts                 Speech output UI (active only with the `tts` feature)
src-tauri/src/main.rs     Rust backend: ptys, filesystem, git, folder picker
src-tauri/src/stt.rs      Optional local speech-to-text (`stt` feature)
src-tauri/src/tts.rs      Optional local text-to-speech (`tts` feature)
```

## Status

Early and personal, but functional. Expect rough edges.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

Copyright 2026 Edward Thomson.
