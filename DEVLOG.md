# VantageTerm Dev Log

## 2026-07-18

A batch of quality-of-life work landed on top of the initial VantageTerm commit, plus the project got a proper license. The terminal now supports alt-click to move the cursor to the click point in a normal shell buffer (implemented by synthesizing arrow-key presses, and deliberately left inactive in full-screen apps where that trick would misfire). The file tree gained a persistent toggle for showing or hiding dotfiles. Startup behavior was tightened so the dev launch directory is no longer force-added as a project; only an explicitly passed folder gets added, otherwise the remembered or first project is used. The largest piece was optional, fully local speech-to-text: a new `stt` Cargo feature wires cpal audio capture into whisper.cpp and transcribes voice input straight into the active terminal, with a matching frontend module and UI. Finally, an Apache 2.0 LICENSE was added and referenced from the README.

**Decisions & notes:** STT is off by default and gated behind a Cargo feature, keeping the heavy whisper.cpp dependency out of default builds. Model weights live in the user data dir and are never committed; the privacy stance is that voice never leaves the machine.
