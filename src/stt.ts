import { invoke } from "@tauri-apps/api/core";

// Optional, fully-local speech-to-text. The heavy engine (whisper.cpp + mic
// capture) lives behind the Rust `stt` Cargo feature, off by default. When that
// feature isn't compiled, `stt_available` returns false and this module injects
// nothing, so the default build has no voice UI and no extra weight.
//
// Contract with the backend (only present when built with --features stt):
//   stt_available() -> boolean            model compiled in AND weights on disk
//   stt_start()     -> ()                 begin capturing the microphone
//   stt_stop()      -> string             stop, transcribe locally, return text
//
// Push-to-talk UX: click to start recording, click again to stop; the local
// transcript is typed into the active terminal for you to review (we never
// press Enter for you). Audio never leaves the machine.

export async function initStt(typeIntoActiveTerminal: (text: string) => void) {
  let available = false;
  try {
    available = await invoke<boolean>("stt_available");
  } catch {
    available = false; // command absent => built without the stt feature
  }
  if (!available) return;

  const strip = document.getElementById("subtabs-term")!;
  const btn = document.createElement("button");
  btn.id = "mic-btn";
  btn.textContent = "voice";
  btn.title = "Voice input: click to record, click again to transcribe (local)";
  strip.appendChild(btn);

  let recording = false;
  let busy = false;

  const setIdle = () => {
    recording = false;
    btn.classList.remove("recording");
    btn.textContent = "voice";
    btn.title = "Voice input: click to record, click again to transcribe (local)";
  };

  btn.addEventListener("click", async () => {
    if (busy) return;
    if (!recording) {
      busy = true;
      // Instant press feedback before the mic finishes initializing.
      btn.classList.add("recording");
      btn.textContent = "○ …";
      try {
        await invoke("stt_start");
        recording = true;
        btn.textContent = "● rec";
        btn.title = "Recording… click to stop and transcribe";
      } catch (e) {
        console.error("stt_start failed", e);
        setIdle();
      } finally {
        busy = false;
      }
    } else {
      busy = true;
      // Distinct "transcribing" state with an animated spinner: the mic has
      // already stopped here, and the motion confirms the click registered and
      // work is happening. The first frame is set synchronously for instant
      // feedback, before any await.
      btn.classList.remove("recording");
      btn.classList.add("transcribing");
      const frames = "◐◓◑◒";
      let f = 0;
      btn.textContent = `${frames[0]} transcribing`;
      btn.title = "Transcribing locally… (the mic has stopped)";
      const spin = window.setInterval(() => {
        f = (f + 1) % frames.length;
        btn.textContent = `${frames[f]} transcribing`;
      }, 120);
      // Force the browser to actually paint the transcribing state before we
      // begin the transcription call, so the feedback is never skipped.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const started = Date.now();
      try {
        const text = await invoke<string>("stt_stop");
        if (text) typeIntoActiveTerminal(text);
      } catch (e) {
        console.error("stt_stop failed", e);
      } finally {
        // Keep the indicator on screen long enough to actually be seen, even
        // when transcription returns almost instantly.
        const elapsed = Date.now() - started;
        if (elapsed < 500) await new Promise((r) => setTimeout(r, 500 - elapsed));
        clearInterval(spin);
        btn.classList.remove("transcribing");
        setIdle();
        busy = false;
      }
    }
  });
}
