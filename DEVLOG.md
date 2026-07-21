# VantageTerm Dev Log

## 2026-07-21

A small naming pass on the voice features just after midnight: the tab-strip buttons were relabeled from "voice" and "speak" to "dictate" and "read aloud". The old bare verbs were ambiguous about who is doing what; the new verb phrases carry a conventional subject (you dictate into the terminal, the app reads the selection aloud to you). The README was updated to match.

## 2026-07-20

A productive day rounding out the voice story and fixing everyday friction. The headline feature is optional, fully local text-to-speech as a mirror of the existing speech-to-text: a new `tts` Cargo feature wires piper-rs and rodio into the backend, a speak button appears in the tab strip only when the build has the feature and a Piper voice (`.onnx` plus `.onnx.json`) is present in the user models directory, and selecting terminal text then clicking the button reads it aloud, with a second click stopping mid-utterance. Speech-to-text also got smarter about language: models with `.en` in the filename stay pinned to English, while any other whisper model is treated as multilingual with the spoken language auto-detected, so dictating in another language is now just a matter of dropping in a multilingual ggml model. Two quality-of-life fixes landed alongside: the file tree now auto-refreshes on the existing 2.5-second changes poll (so files created by an agent in a terminal finally show up without a project switch), and typing `exit` at a shell prompt now closes its tab cleanly instead of leaving a dead pane.

**Decisions & notes:** TTS deliberately follows the stt pattern everywhere: feature-gated heavy dependencies, "unavailable" stubs in default builds, frontend UI injected only when the backend reports available, and a strict nothing-leaves-the-machine stance. The tree refresh compares each directory listing against a signature of what is rendered and rebuilds only changed directories, so quiet ticks touch no DOM and scroll, expansion, and selection survive. Tab auto-close only fires on a clean exit (status 0); a killed or crashed shell keeps its tab open showing `[process exited]` so the last output stays readable, and the backend now reaps the pty session on exit rather than waiting for the tab to close.

## 2026-07-19

A day of README polish aimed at making the project presentable and easy to adopt. The old bare-bones Build section was expanded into two proper guides: building a standalone release binary (including the `--features stt` variant for local voice input) and installing it as a `vantageterm` command by symlinking into `~/.local/bin`, with notes on how the symlink interacts with rebuilds and `cargo clean`. The README also gained its first visuals: a diff-review screenshot and, as the lead image, a screenshot of a live Claude Code session running inside the terminal. Alt-click-to-move-cursor was promoted from a buried mention to its own feature bullet, and a scratch `temp/` directory was added to `.gitignore`.

**Decisions & notes:** The install instructions deliberately recommend a symlink over a copy so rebuilds are picked up automatically, with `cp` noted as the alternative for a binary that survives `cargo clean`. Screenshots live under `docs/` and are committed to the repo.

## 2026-07-18

A batch of quality-of-life work landed on top of the initial VantageTerm commit, plus the project got a proper license. The terminal now supports alt-click to move the cursor to the click point in a normal shell buffer (implemented by synthesizing arrow-key presses, and deliberately left inactive in full-screen apps where that trick would misfire). The file tree gained a persistent toggle for showing or hiding dotfiles. Startup behavior was tightened so the dev launch directory is no longer force-added as a project; only an explicitly passed folder gets added, otherwise the remembered or first project is used. The largest piece was optional, fully local speech-to-text: a new `stt` Cargo feature wires cpal audio capture into whisper.cpp and transcribes voice input straight into the active terminal, with a matching frontend module and UI. Finally, an Apache 2.0 LICENSE was added and referenced from the README.

**Decisions & notes:** STT is off by default and gated behind a Cargo feature, keeping the heavy whisper.cpp dependency out of default builds. Model weights live in the user data dir and are never committed; the privacy stance is that voice never leaves the machine.
