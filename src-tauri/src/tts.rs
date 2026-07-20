// Optional, fully-local text-to-speech. The real engine (Piper via onnxruntime,
// playback via rodio) is compiled only under the `tts` Cargo feature; without it
// these commands still exist but report unavailable, so the default build pulls
// in no ML/audio dependencies.
//
// Nothing leaves the machine: text is synthesized by a local Piper voice and
// played on the default output device. The voice is read from
// ~/.local/share/vantageterm/models/ (first *.onnx with a sibling *.onnx.json).

#[tauri::command]
pub fn tts_available() -> bool {
    backend::available()
}

#[tauri::command]
pub fn tts_speak(text: String) -> Result<(), String> {
    backend::speak(&text)
}

#[tauri::command]
pub fn tts_stop() -> Result<(), String> {
    backend::stop()
}

#[cfg(not(feature = "tts"))]
mod backend {
    pub fn available() -> bool {
        false
    }
    pub fn speak(_text: &str) -> Result<(), String> {
        Err("built without the `tts` feature".into())
    }
    pub fn stop() -> Result<(), String> {
        Err("built without the `tts` feature".into())
    }
}

#[cfg(feature = "tts")]
mod backend {
    use piper_rs::Piper;
    use rodio::buffer::SamplesBuffer;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    // The voice model is loaded once and reused across utterances, same as the
    // whisper context in stt.rs.
    static PIPER: Mutex<Option<Piper>> = Mutex::new(None);
    // The sink currently playing, if any, so stop() can halt it from another
    // invoke while speak() is blocked in sleep_until_end().
    static SINK: Mutex<Option<Arc<rodio::Sink>>> = Mutex::new(None);

    fn data_home() -> Option<PathBuf> {
        if let Ok(x) = std::env::var("XDG_DATA_HOME") {
            if !x.is_empty() {
                return Some(PathBuf::from(x));
            }
        }
        std::env::var("HOME")
            .ok()
            .map(|h| PathBuf::from(h).join(".local").join("share"))
    }

    // A Piper voice is an .onnx model plus its .onnx.json config; both must be
    // present for the voice to be usable.
    fn voice_paths() -> Option<(PathBuf, PathBuf)> {
        let dir = data_home()?.join("vantageterm").join("models");
        for entry in std::fs::read_dir(&dir).ok()?.flatten() {
            let p = entry.path();
            if p.extension().map(|e| e == "onnx").unwrap_or(false) {
                let mut config = p.clone().into_os_string();
                config.push(".json");
                let config = PathBuf::from(config);
                if config.is_file() {
                    return Some((p, config));
                }
            }
        }
        None
    }

    pub fn available() -> bool {
        voice_paths().is_some()
    }

    pub fn speak(text: &str) -> Result<(), String> {
        let text = text.trim();
        if text.is_empty() {
            return Ok(());
        }
        // Replace any utterance already playing rather than queueing behind it.
        let _ = stop();

        let (samples, rate) = synthesize(text)?;
        if samples.is_empty() {
            return Ok(());
        }

        let (_stream, handle) =
            rodio::OutputStream::try_default().map_err(|e| format!("audio output: {e}"))?;
        let sink = Arc::new(rodio::Sink::try_new(&handle).map_err(|e| format!("audio sink: {e}"))?);
        *SINK.lock().unwrap() = Some(sink.clone());

        sink.append(SamplesBuffer::new(1, rate, samples));
        // Block until playback finishes (or stop() halts the sink); the
        // frontend awaits this to know when speaking has ended.
        sink.sleep_until_end();

        let mut guard = SINK.lock().unwrap();
        if guard.as_ref().map(|s| Arc::ptr_eq(s, &sink)).unwrap_or(false) {
            *guard = None;
        }
        Ok(())
    }

    pub fn stop() -> Result<(), String> {
        if let Some(sink) = SINK.lock().unwrap().take() {
            sink.stop();
        }
        Ok(())
    }

    fn synthesize(text: &str) -> Result<(Vec<f32>, u32), String> {
        let mut cache = PIPER.lock().unwrap();
        if cache.is_none() {
            let (onnx, config) = voice_paths().ok_or("no piper voice found")?;
            let piper = Piper::new(&onnx, &config).map_err(|e| format!("load voice: {e}"))?;
            *cache = Some(piper);
        }
        let piper = cache.as_mut().unwrap();
        let (samples, rate) = piper
            .create(text, false, None, None, None, None)
            .map_err(|e| format!("synthesize: {e}"))?;
        Ok((samples, rate))
    }
}
