import { invoke } from "@tauri-apps/api/core";

// Optional, fully-local text-to-speech. The heavy engine (Piper + onnxruntime)
// lives behind the Rust `tts` Cargo feature, off by default. When that feature
// isn't compiled, `tts_available` returns false and this module injects
// nothing, so the default build has no speech UI and no extra weight.
//
// Contract with the backend (only present when built with --features tts):
//   tts_available() -> boolean      engine compiled in AND a voice on disk
//   tts_speak(text) -> ()           synthesize and play; resolves when done
//   tts_stop()      -> ()           halt playback; the speak call resolves
//
// UX: select text in the active terminal, click to hear it read aloud; click
// again to stop mid-utterance. Nothing leaves the machine.

export async function initTts(getSelection: () => string) {
  let available = false;
  try {
    available = await invoke<boolean>("tts_available");
  } catch {
    available = false; // command absent => built without the tts feature
  }
  if (!available) return;

  const strip = document.getElementById("subtabs-term")!;
  const btn = document.createElement("button");
  btn.id = "speak-btn";
  const idleTitle =
    "Speech output: select terminal text, click to hear it (local)";
  btn.textContent = "speak";
  btn.title = idleTitle;
  strip.appendChild(btn);

  let speaking = false;
  let hintTimer = 0;

  const setIdle = () => {
    speaking = false;
    btn.classList.remove("speaking");
    btn.textContent = "speak";
    btn.title = idleTitle;
  };

  btn.addEventListener("click", async () => {
    if (speaking) {
      // The in-flight tts_speak resolves once playback halts; its finally
      // block restores the idle state.
      try {
        await invoke("tts_stop");
      } catch (e) {
        console.error("tts_stop failed", e);
      }
      return;
    }
    const text = getSelection();
    if (!text.trim()) {
      // No selection: hint instead of speaking, then quietly recover.
      clearTimeout(hintTimer);
      btn.textContent = "select text first";
      hintTimer = window.setTimeout(() => {
        if (!speaking) setIdle();
      }, 1400);
      return;
    }
    // Flip state synchronously so a rapid second click is a stop, not a
    // second utterance.
    speaking = true;
    clearTimeout(hintTimer);
    btn.classList.add("speaking");
    btn.textContent = "■ stop";
    btn.title = "Speaking (click to stop)";
    try {
      await invoke("tts_speak", { text });
    } catch (e) {
      console.error("tts_speak failed", e);
    } finally {
      setIdle();
    }
  });
}
