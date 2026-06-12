use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::storage;

#[derive(Serialize, Clone, PartialEq)]
pub enum RecordingPhase {
    Idle,
    Recording,
    Paused,
    Encoding,
}

#[derive(Clone, PartialEq)]
enum RecordingKind {
    None,
    Ffmpeg,
    WindowCapture,
}

pub struct RecordingManager {
    phase: Mutex<RecordingPhase>,
    kind: Mutex<RecordingKind>,
    ffmpeg_process: Mutex<Option<Child>>,
    capture_thread: Mutex<Option<std::thread::JoinHandle<()>>>,
    stop_signal: Arc<AtomicBool>,
    pause_signal: Arc<AtomicBool>,
    session_id: Mutex<Option<String>>,
    session_dir: Mutex<Option<PathBuf>>,
    started_at: Mutex<Option<Instant>>,
    paused_at: Mutex<Option<Instant>>,
    total_paused: Mutex<Duration>,
    snapshots: Mutex<Vec<u64>>,
    snapshot_active: Mutex<bool>,
}

impl RecordingManager {
    pub fn new() -> Self {
        Self {
            phase: Mutex::new(RecordingPhase::Idle),
            kind: Mutex::new(RecordingKind::None),
            ffmpeg_process: Mutex::new(None),
            capture_thread: Mutex::new(None),
            stop_signal: Arc::new(AtomicBool::new(false)),
            pause_signal: Arc::new(AtomicBool::new(false)),
            session_id: Mutex::new(None),
            session_dir: Mutex::new(None),
            started_at: Mutex::new(None),
            paused_at: Mutex::new(None),
            total_paused: Mutex::new(Duration::ZERO),
            snapshots: Mutex::new(Vec::new()),
            snapshot_active: Mutex::new(false),
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[derive(Serialize)]
pub struct RecordingStartResult {
    session_id: String,
}

#[tauri::command]
pub fn recording_start(
    source_id: String,
    source_kind: String,
    state: tauri::State<'_, RecordingManager>,
) -> Result<RecordingStartResult, String> {
    let current_phase = state.phase.lock().map_err(|e| e.to_string())?;
    if *current_phase != RecordingPhase::Idle {
        return Err("Recording already in progress".to_string());
    }
    drop(current_phase);

    let session_id = Uuid::new_v4().to_string();
    let session_dir = storage::app_data_dir()
        .join("sessions")
        .join(&session_id);
    let frames_dir = session_dir.join("frames");
    fs::create_dir_all(&frames_dir).map_err(|e| e.to_string())?;

    match source_kind.as_str() {
        "Screen" | "Camera" => {
            let frame_pattern = frames_dir
                .join("frame-%06d.jpg")
                .to_string_lossy()
                .to_string();

            let input = if source_kind == "Screen" {
                format!("{}:none", source_id)
            } else {
                source_id.clone()
            };

            let mut args = vec!["-f".to_string(), "avfoundation".to_string()];
            if source_kind == "Camera" {
                args.push("-framerate".to_string());
                args.push("30".to_string());
            }
            args.push("-i".to_string());
            args.push(input);
            args.push("-r".to_string());
            args.push("1".to_string());
            if source_kind == "Camera" {
                args.push("-q:v".to_string());
                args.push("2".to_string());
            }
            args.push(frame_pattern);

            let child = Command::new("ffmpeg")
                .args(&args)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

            *state.ffmpeg_process.lock().map_err(|e| e.to_string())? = Some(child);
            *state.kind.lock().map_err(|e| e.to_string())? = RecordingKind::Ffmpeg;
        }
        "Window" => {
            state.stop_signal.store(false, Ordering::SeqCst);
            state.pause_signal.store(false, Ordering::SeqCst);

            let stop = Arc::clone(&state.stop_signal);
            let pause = Arc::clone(&state.pause_signal);
            let window_id = source_id.clone();
            let frames = frames_dir.clone();

            let handle = std::thread::spawn(move || {
                let mut frame_num = 0u32;
                loop {
                    if stop.load(Ordering::SeqCst) {
                        break;
                    }
                    if !pause.load(Ordering::SeqCst) {
                        frame_num += 1;
                        let frame_path = frames.join(format!("frame-{:06}.jpg", frame_num));
                        let _ = Command::new("screencapture")
                            .args([
                                "-x",
                                "-l",
                                &window_id,
                                "-t",
                                "jpg",
                                &frame_path.to_string_lossy(),
                            ])
                            .stdout(Stdio::null())
                            .stderr(Stdio::null())
                            .status();
                    }
                    std::thread::sleep(Duration::from_secs(1));
                }
            });

            *state.capture_thread.lock().map_err(|e| e.to_string())? = Some(handle);
            *state.kind.lock().map_err(|e| e.to_string())? = RecordingKind::WindowCapture;
        }
        _ => return Err(format!("Unknown source kind: {}", source_kind)),
    }

    *state.session_id.lock().map_err(|e| e.to_string())? = Some(session_id.clone());
    *state.session_dir.lock().map_err(|e| e.to_string())? = Some(session_dir);
    *state.started_at.lock().map_err(|e| e.to_string())? = Some(Instant::now());
    *state.total_paused.lock().map_err(|e| e.to_string())? = Duration::ZERO;
    *state.paused_at.lock().map_err(|e| e.to_string())? = None;

    let mut snapshots = state.snapshots.lock().map_err(|e| e.to_string())?;
    snapshots.clear();
    snapshots.push(now_ms());

    *state.snapshot_active.lock().map_err(|e| e.to_string())? = true;
    *state.phase.lock().map_err(|e| e.to_string())? = RecordingPhase::Recording;

    Ok(RecordingStartResult { session_id })
}

#[tauri::command]
pub fn recording_pause(state: tauri::State<'_, RecordingManager>) -> Result<(), String> {
    let mut phase = state.phase.lock().map_err(|e| e.to_string())?;
    if *phase != RecordingPhase::Recording {
        return Err("Not recording".to_string());
    }

    let kind = state.kind.lock().map_err(|e| e.to_string())?.clone();
    match kind {
        RecordingKind::Ffmpeg => {
            if let Some(ref child) = *state.ffmpeg_process.lock().map_err(|e| e.to_string())? {
                let pid = child.id();
                unsafe { libc::kill(pid as i32, libc::SIGSTOP); }
            }
        }
        RecordingKind::WindowCapture => {
            state.pause_signal.store(true, Ordering::SeqCst);
        }
        RecordingKind::None => {}
    }

    *state.paused_at.lock().map_err(|e| e.to_string())? = Some(Instant::now());
    *state.snapshot_active.lock().map_err(|e| e.to_string())? = false;
    *phase = RecordingPhase::Paused;
    Ok(())
}

#[tauri::command]
pub fn recording_resume(state: tauri::State<'_, RecordingManager>) -> Result<(), String> {
    let mut phase = state.phase.lock().map_err(|e| e.to_string())?;
    if *phase != RecordingPhase::Paused {
        return Err("Not paused".to_string());
    }

    let kind = state.kind.lock().map_err(|e| e.to_string())?.clone();
    match kind {
        RecordingKind::Ffmpeg => {
            if let Some(ref child) = *state.ffmpeg_process.lock().map_err(|e| e.to_string())? {
                let pid = child.id();
                unsafe { libc::kill(pid as i32, libc::SIGCONT); }
            }
        }
        RecordingKind::WindowCapture => {
            state.pause_signal.store(false, Ordering::SeqCst);
        }
        RecordingKind::None => {}
    }

    if let Some(paused_at) = state.paused_at.lock().map_err(|e| e.to_string())?.take() {
        let mut total = state.total_paused.lock().map_err(|e| e.to_string())?;
        *total += paused_at.elapsed();
    }

    *state.snapshot_active.lock().map_err(|e| e.to_string())? = true;
    *phase = RecordingPhase::Recording;
    Ok(())
}

#[derive(Serialize)]
pub struct RecordingStopResult {
    session_id: String,
    frame_count: u32,
    snapshots: Vec<u64>,
    elapsed_seconds: f64,
}

#[tauri::command]
pub fn recording_stop(
    state: tauri::State<'_, RecordingManager>,
) -> Result<RecordingStopResult, String> {
    let current_phase = state.phase.lock().map_err(|e| e.to_string())?.clone();
    if current_phase != RecordingPhase::Recording && current_phase != RecordingPhase::Paused {
        return Err("Not recording".to_string());
    }

    let kind = state.kind.lock().map_err(|e| e.to_string())?.clone();
    match kind {
        RecordingKind::Ffmpeg => {
            if let Some(mut child) =
                state.ffmpeg_process.lock().map_err(|e| e.to_string())?.take()
            {
                let pid = child.id();
                unsafe {
                    libc::kill(pid as i32, libc::SIGCONT);
                    libc::kill(pid as i32, libc::SIGTERM);
                }
                let _ = child.wait();
            }
        }
        RecordingKind::WindowCapture => {
            state.stop_signal.store(true, Ordering::SeqCst);
            state.pause_signal.store(false, Ordering::SeqCst);
            if let Some(handle) =
                state.capture_thread.lock().map_err(|e| e.to_string())?.take()
            {
                let _ = handle.join();
            }
        }
        RecordingKind::None => {}
    }

    let session_id = state
        .session_id
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("No active session")?;

    let session_dir = state
        .session_dir
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("No session directory")?;

    let frames_dir = session_dir.join("frames");
    let frame_count = count_frames(&frames_dir)?;

    let elapsed_seconds =
        if let Some(started) = *state.started_at.lock().map_err(|e| e.to_string())? {
            let total_elapsed = started.elapsed();
            let paused = *state.total_paused.lock().map_err(|e| e.to_string())?;
            let extra_pause = if current_phase == RecordingPhase::Paused {
                state
                    .paused_at
                    .lock()
                    .map_err(|e| e.to_string())?
                    .map(|p| p.elapsed())
                    .unwrap_or(Duration::ZERO)
            } else {
                Duration::ZERO
            };
            (total_elapsed - paused - extra_pause).as_secs_f64()
        } else {
            0.0
        };

    let snapshots = state.snapshots.lock().map_err(|e| e.to_string())?.clone();

    *state.snapshot_active.lock().map_err(|e| e.to_string())? = false;
    *state.kind.lock().map_err(|e| e.to_string())? = RecordingKind::None;
    *state.phase.lock().map_err(|e| e.to_string())? = RecordingPhase::Idle;

    Ok(RecordingStopResult {
        session_id,
        frame_count,
        snapshots,
        elapsed_seconds,
    })
}

fn count_frames(frames_dir: &PathBuf) -> Result<u32, String> {
    Ok(fs::read_dir(frames_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "jpg")
                .unwrap_or(false)
        })
        .count() as u32)
}

#[tauri::command]
pub fn recording_tick_snapshot(state: tauri::State<'_, RecordingManager>) -> Result<(), String> {
    let active = *state.snapshot_active.lock().map_err(|e| e.to_string())?;
    if active {
        state
            .snapshots
            .lock()
            .map_err(|e| e.to_string())?
            .push(now_ms());
    }
    Ok(())
}

#[tauri::command]
pub fn recording_get_latest_frame(
    state: tauri::State<'_, RecordingManager>,
) -> Result<Option<String>, String> {
    let session_dir = state.session_dir.lock().map_err(|e| e.to_string())?;
    let session_dir = match session_dir.as_ref() {
        Some(d) => d,
        None => return Ok(None),
    };

    let frames_dir = session_dir.join("frames");
    if !frames_dir.exists() {
        return Ok(None);
    }

    let mut frames: Vec<_> = fs::read_dir(&frames_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "jpg")
                .unwrap_or(false)
        })
        .collect();

    frames.sort_by_key(|e| e.file_name());

    match frames.last() {
        Some(entry) => {
            let bytes = fs::read(entry.path()).map_err(|e| e.to_string())?;
            if bytes.is_empty() {
                return Ok(None);
            }
            let b64 = STANDARD.encode(&bytes);
            Ok(Some(format!("data:image/jpeg;base64,{}", b64)))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn recording_get_elapsed(state: tauri::State<'_, RecordingManager>) -> Result<f64, String> {
    let phase = state.phase.lock().map_err(|e| e.to_string())?.clone();
    if phase == RecordingPhase::Idle {
        return Ok(0.0);
    }

    if let Some(started) = *state.started_at.lock().map_err(|e| e.to_string())? {
        let total = started.elapsed();
        let paused = *state.total_paused.lock().map_err(|e| e.to_string())?;
        let extra = if phase == RecordingPhase::Paused {
            state
                .paused_at
                .lock()
                .map_err(|e| e.to_string())?
                .map(|p| p.elapsed())
                .unwrap_or(Duration::ZERO)
        } else {
            Duration::ZERO
        };
        Ok((total - paused - extra).as_secs_f64())
    } else {
        Ok(0.0)
    }
}

#[tauri::command]
pub fn recording_get_phase(state: tauri::State<'_, RecordingManager>) -> Result<String, String> {
    let phase = state.phase.lock().map_err(|e| e.to_string())?;
    Ok(match *phase {
        RecordingPhase::Idle => "Idle",
        RecordingPhase::Recording => "Recording",
        RecordingPhase::Paused => "Paused",
        RecordingPhase::Encoding => "Encoding",
    }
    .to_string())
}
