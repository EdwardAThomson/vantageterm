// Optional, fully-local speech-to-text. The real engine (microphone capture via
// cpal + transcription via whisper.cpp) is compiled only under the `stt` Cargo
// feature; without it these commands still exist but report unavailable, so the
// default build pulls in no audio/ML dependencies.
//
// Audio never leaves the machine: mic samples are captured to memory, resampled
// to 16 kHz mono, and run through a local Whisper model. The model weights are
// read from ~/.local/share/vantageterm/models/ (first *.bin found).

#[tauri::command]
pub fn stt_available() -> bool {
    backend::available()
}

#[tauri::command]
pub fn stt_start() -> Result<(), String> {
    backend::start()
}

#[tauri::command]
pub fn stt_stop() -> Result<String, String> {
    backend::stop()
}

#[cfg(not(feature = "stt"))]
mod backend {
    pub fn available() -> bool {
        false
    }
    pub fn start() -> Result<(), String> {
        Err("built without the `stt` feature".into())
    }
    pub fn stop() -> Result<String, String> {
        Err("built without the `stt` feature".into())
    }
}

#[cfg(feature = "stt")]
mod backend {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use std::path::PathBuf;
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread::JoinHandle;
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    struct Recording {
        stop: mpsc::Sender<()>,
        handle: JoinHandle<(Vec<f32>, u32)>,
    }

    // `Mutex::new` is const, so a plain static holds the in-flight recording.
    static REC: Mutex<Option<Recording>> = Mutex::new(None);
    // The model is loaded once and reused; reloading 142MB per utterance was
    // the dominant cost of each transcription.
    static CTX: Mutex<Option<WhisperContext>> = Mutex::new(None);

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

    fn model_path() -> Option<PathBuf> {
        let dir = data_home()?.join("vantageterm").join("models");
        for entry in std::fs::read_dir(&dir).ok()?.flatten() {
            let p = entry.path();
            if p.extension().map(|e| e == "bin").unwrap_or(false) {
                return Some(p);
            }
        }
        None
    }

    pub fn available() -> bool {
        model_path().is_some()
    }

    pub fn start() -> Result<(), String> {
        let mut guard = REC.lock().unwrap();
        if guard.is_some() {
            return Err("already recording".into());
        }
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        // The audio stream is not Send on some platforms, so it lives entirely
        // inside this thread; we only ship samples back when it stops.
        let handle = std::thread::spawn(move || record(stop_rx, ready_tx));
        match ready_rx.recv() {
            Ok(Ok(())) => {
                *guard = Some(Recording {
                    stop: stop_tx,
                    handle,
                });
                Ok(())
            }
            Ok(Err(e)) => {
                let _ = handle.join();
                Err(e)
            }
            Err(_) => Err("recorder thread exited before it was ready".into()),
        }
    }

    pub fn stop() -> Result<String, String> {
        let rec = REC.lock().unwrap().take().ok_or("not recording")?;
        let _ = rec.stop.send(());
        let (samples, rate) = rec
            .handle
            .join()
            .map_err(|_| "recorder thread panicked".to_string())?;
        if samples.is_empty() {
            return Ok(String::new());
        }
        transcribe(&resample_to_16k(&samples, rate))
    }

    fn record(
        stop_rx: mpsc::Receiver<()>,
        ready_tx: mpsc::Sender<Result<(), String>>,
    ) -> (Vec<f32>, u32) {
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                let _ = ready_tx.send(Err("no input (microphone) device found".into()));
                return (vec![], 16000);
            }
        };
        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("input config: {e}")));
                return (vec![], 16000);
            }
        };
        let rate = config.sample_rate().0;
        let channels = config.channels() as usize;
        let buf: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = buf.clone();
        let err_fn = |e| eprintln!("stt input stream error: {e}");
        let stream_cfg: cpal::StreamConfig = config.clone().into();

        // Downmix interleaved frames to mono f32 in the capture callback.
        let built = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &stream_cfg,
                move |data: &[f32], _: &_| {
                    let mut b = sink.lock().unwrap();
                    for frame in data.chunks(channels) {
                        b.push(frame.iter().copied().sum::<f32>() / channels as f32);
                    }
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &stream_cfg,
                move |data: &[i16], _: &_| {
                    let mut b = sink.lock().unwrap();
                    for frame in data.chunks(channels) {
                        let m = frame.iter().map(|&s| s as f32 / 32768.0).sum::<f32>()
                            / channels as f32;
                        b.push(m);
                    }
                },
                err_fn,
                None,
            ),
            other => {
                let _ = ready_tx.send(Err(format!("unsupported sample format {other:?}")));
                return (vec![], rate);
            }
        };
        let stream = match built {
            Ok(s) => s,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("build input stream: {e}")));
                return (vec![], rate);
            }
        };
        if let Err(e) = stream.play() {
            let _ = ready_tx.send(Err(format!("start stream: {e}")));
            return (vec![], rate);
        }
        let _ = ready_tx.send(Ok(()));
        let _ = stop_rx.recv(); // block until stop() signals
        drop(stream);
        let samples = buf.lock().unwrap().clone();
        (samples, rate)
    }

    // Naive linear resample to Whisper's required 16 kHz. Fine for speech.
    fn resample_to_16k(samples: &[f32], rate: u32) -> Vec<f32> {
        if rate == 16000 || samples.is_empty() {
            return samples.to_vec();
        }
        let ratio = 16000f32 / rate as f32;
        let out_len = (samples.len() as f32 * ratio) as usize;
        let mut out = Vec::with_capacity(out_len);
        for i in 0..out_len {
            let src = i as f32 / ratio;
            let idx = src as usize;
            let frac = src - idx as f32;
            let a = samples.get(idx).copied().unwrap_or(0.0);
            let b = samples.get(idx + 1).copied().unwrap_or(a);
            out.push(a + (b - a) * frac);
        }
        out
    }

    fn transcribe(audio: &[f32]) -> Result<String, String> {
        let mut cache = CTX.lock().unwrap();
        if cache.is_none() {
            let model = model_path().ok_or("no whisper model found")?;
            let ctx = WhisperContext::new_with_params(
                &model.to_string_lossy(),
                WhisperContextParameters::default(),
            )
            .map_err(|e| format!("load model: {e}"))?;
            *cache = Some(ctx);
        }
        let ctx = cache.as_ref().unwrap();
        let mut state = ctx.create_state().map_err(|e| format!("create state: {e}"))?;

        let threads = std::thread::available_parallelism()
            .map(|n| n.get() as i32)
            .unwrap_or(4);
        // English-only models carry ".en" in the name (e.g. ggml-base.en.bin)
        // and are pinned to English; multilingual models auto-detect the
        // spoken language instead.
        let english_only = model_path()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().contains(".en")))
            .unwrap_or(true);
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(threads);
        params.set_language(Some(if english_only { "en" } else { "auto" }));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        state
            .full(params, audio)
            .map_err(|e| format!("transcribe: {e}"))?;

        let segments = state
            .full_n_segments()
            .map_err(|e| format!("segments: {e}"))?;
        let mut text = String::new();
        for i in 0..segments {
            if let Ok(seg) = state.full_get_segment_text(i) {
                text.push_str(&seg);
            }
        }
        Ok(text.trim().to_string())
    }
}
