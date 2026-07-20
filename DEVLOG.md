# VantageTerm Dev Log

## 2026-07-19

A day of README polish aimed at making the project presentable and easy to adopt. The old bare-bones Build section was expanded into two proper guides: building a standalone release binary (including the `--features stt` variant for local voice input) and installing it as a `vantageterm` command by symlinking into `~/.local/bin`, with notes on how the symlink interacts with rebuilds and `cargo clean`. The README also gained its first visuals: a diff-review screenshot and, as the lead image, a screenshot of a live Claude Code session running inside the terminal. Alt-click-to-move-cursor was promoted from a buried mention to its own feature bullet, and a scratch `temp/` directory was added to `.gitignore`.

**Decisions & notes:** The install instructions deliberately recommend a symlink over a copy so rebuilds are picked up automatically, with `cp` noted as the alternative for a binary that survives `cargo clean`. Screenshots live under `docs/` and are committed to the repo.

## 2026-07-18

A batch of quality-of-life work landed on top of the initial VantageTerm commit, plus the project got a proper license. The terminal now supports alt-click to move the cursor to the click point in a normal shell buffer (implemented by synthesizing arrow-key presses, and deliberately left inactive in full-screen apps where that trick would misfire). The file tree gained a persistent toggle for showing or hiding dotfiles. Startup behavior was tightened so the dev launch directory is no longer force-added as a project; only an explicitly passed folder gets added, otherwise the remembered or first project is used. The largest piece was optional, fully local speech-to-text: a new `stt` Cargo feature wires cpal audio capture into whisper.cpp and transcribes voice input straight into the active terminal, with a matching frontend module and UI. Finally, an Apache 2.0 LICENSE was added and referenced from the README.

**Decisions & notes:** STT is off by default and gated behind a Cargo feature, keeping the heavy whisper.cpp dependency out of default builds. Model weights live in the user data dir and are never committed; the privacy stance is that voice never leaves the machine.
