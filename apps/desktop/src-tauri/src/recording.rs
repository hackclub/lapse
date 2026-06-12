use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use core_foundation::array::CFArray;
use core_foundation::base::{CFType, TCFType};
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::base::kCGImageAlphaPremultipliedLast;
use core_graphics::color_space::CGColorSpace;
use core_graphics::context::CGContext;
use core_graphics::geometry::{CGPoint, CGRect, CGSize};
use core_graphics::image::CGImage;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::sources;
use crate::storage;

extern "C" {
    fn CGWindowListCopyWindowInfo(
        option: u32,
        relative_to_window: u32,
    ) -> core_foundation::base::CFTypeRef;

    fn CGRectMakeWithDictionaryRepresentation(
        dict: *const libc::c_void,
        rect: *mut CGRect,
    ) -> bool;
}

const K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1 << 0;
const K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS: u32 = 1 << 4;

#[derive(Deserialize, Clone)]
pub struct SourceInput {
    pub id: String,
    pub kind: String,
    pub name: String,
}

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
    Ffmpeg,        // Camera only
    NativeCapture, // Screen/Window (single or multi)
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
    sources: Vec<SourceInput>,
    state: tauri::State<'_, RecordingManager>,
) -> Result<RecordingStartResult, String> {
    if sources.is_empty() {
        return Err("No sources provided".to_string());
    }

    let current_phase = state.phase.lock().map_err(|e| e.to_string())?;
    if *current_phase != RecordingPhase::Idle {
        return Err("Recording already in progress".to_string());
    }
    drop(current_phase);

    let session_id = Uuid::new_v4().to_string();
    let session_dir = storage::app_data_dir().join("sessions").join(&session_id);
    let frames_dir = session_dir.join("frames");
    fs::create_dir_all(&frames_dir).map_err(|e| e.to_string())?;

    // Check if any source is a Camera
    let has_camera = sources.iter().any(|s| s.kind == "Camera");

    if has_camera {
        // Camera path: use FFmpeg (single camera, take the first one)
        let camera_source = sources.iter().find(|s| s.kind == "Camera").unwrap();

        let frame_pattern = frames_dir
            .join("frame-%06d.jpg")
            .to_string_lossy()
            .to_string();

        let args = vec![
            "-f".to_string(),
            "avfoundation".to_string(),
            "-framerate".to_string(),
            "30".to_string(),
            "-i".to_string(),
            camera_source.id.clone(),
            "-r".to_string(),
            "1".to_string(),
            "-q:v".to_string(),
            "2".to_string(),
            frame_pattern,
        ];

        let child = Command::new("ffmpeg")
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

        *state.ffmpeg_process.lock().map_err(|e| e.to_string())? = Some(child);
        *state.kind.lock().map_err(|e| e.to_string())? = RecordingKind::Ffmpeg;
    } else {
        // NativeCapture path: Screen/Window sources (single or multi)
        state.stop_signal.store(false, Ordering::SeqCst);
        state.pause_signal.store(false, Ordering::SeqCst);

        let stop = Arc::clone(&state.stop_signal);
        let pause = Arc::clone(&state.pause_signal);
        let sources_clone = sources.clone();
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
                    capture_multi_frame(&sources_clone, &frame_path);
                }
                std::thread::sleep(Duration::from_secs(1));
            }
        });

        *state.capture_thread.lock().map_err(|e| e.to_string())? = Some(handle);
        *state.kind.lock().map_err(|e| e.to_string())? = RecordingKind::NativeCapture;
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

// ---------------------------------------------------------------------------
// Multi-source capture logic
// ---------------------------------------------------------------------------

fn capture_multi_frame(sources: &[SourceInput], frame_path: &Path) {
    if sources.len() == 1 {
        // Single source: just capture and save directly
        if let Some(jpeg) =
            sources::capture_source_to_jpeg(&sources[0].id, &sources[0].kind, &sources[0].name)
        {
            let _ = fs::write(frame_path, jpeg);
        }
        return;
    }

    let all_screens = sources.iter().all(|s| s.kind == "Screen");
    let all_windows = sources.iter().all(|s| s.kind == "Window");

    if all_screens {
        // Multiple screens: composite horizontally
        let images: Vec<CGImage> = sources
            .iter()
            .filter_map(|s| sources::capture_source_image(&s.id, &s.kind, &s.name))
            .collect();

        if images.is_empty() {
            return;
        }

        if let Some(composited) = composite_horizontal(&images) {
            save_cgimage_jpeg(&composited, frame_path);
        }
    } else if all_windows {
        // Multiple windows: check if side-by-side or overlapping
        let window_ids: Vec<u32> = sources
            .iter()
            .filter_map(|s| s.id.parse::<u32>().ok())
            .collect();

        let bounds = get_window_bounds_map(&window_ids);

        if bounds.len() >= 2 && are_side_by_side(&bounds) {
            // Side-by-side: composite at natural positions
            let mut images_with_bounds: Vec<(CGImage, CGRect)> = Vec::new();
            for src in sources {
                if let Some(img) = sources::capture_source_image(&src.id, &src.kind, &src.name) {
                    if let Ok(wid) = src.id.parse::<u32>() {
                        if let Some(rect) = bounds.get(&wid) {
                            images_with_bounds.push((img, *rect));
                        }
                    }
                }
            }
            if let Some(composited) = composite_natural(images_with_bounds) {
                save_cgimage_jpeg(&composited, frame_path);
            }
        } else {
            // Overlapping/maximized: capture only frontmost selected window
            if let Some(front_id) = get_frontmost_window(&window_ids) {
                if let Some(src) = sources.iter().find(|s| {
                    s.id.parse::<u32>().ok() == Some(front_id)
                }) {
                    if let Some(jpeg) =
                        sources::capture_source_to_jpeg(&src.id, &src.kind, &src.name)
                    {
                        let _ = fs::write(frame_path, jpeg);
                    }
                }
            }
        }
    } else {
        // Mixed sources: capture each and composite horizontally
        let images: Vec<CGImage> = sources
            .iter()
            .filter_map(|s| sources::capture_source_image(&s.id, &s.kind, &s.name))
            .collect();

        if images.is_empty() {
            return;
        }

        if images.len() == 1 {
            save_cgimage_jpeg(&images[0], frame_path);
        } else if let Some(composited) = composite_horizontal(&images) {
            save_cgimage_jpeg(&composited, frame_path);
        }
    }
}

// ---------------------------------------------------------------------------
// Window bounds queries via CGWindowListCopyWindowInfo
// ---------------------------------------------------------------------------

fn get_window_bounds_map(window_ids: &[u32]) -> HashMap<u32, CGRect> {
    let mut result = HashMap::new();

    let options =
        K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY | K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS;
    let raw = unsafe { CGWindowListCopyWindowInfo(options, 0) };
    if raw.is_null() {
        return result;
    }

    let array: CFArray<CFDictionary<CFString, CFType>> =
        unsafe { CFArray::wrap_under_create_rule(raw as *mut _) };

    let key_number = CFString::new("kCGWindowNumber");
    let key_bounds = CFString::new("kCGWindowBounds");

    for i in 0..array.len() {
        let dict = unsafe { array.get_unchecked(i) };

        let wid = match dict.find(&key_number) {
            Some(v) => {
                unsafe { CFNumber::wrap_under_get_rule(v.as_CFTypeRef() as *const _) }
                    .to_i64()
                    .unwrap_or(0) as u32
            }
            None => continue,
        };

        if !window_ids.contains(&wid) {
            continue;
        }

        if let Some(bounds_val) = dict.find(&key_bounds) {
            let mut rect = CGRect::new(
                &CGPoint::new(0.0, 0.0),
                &CGSize::new(0.0, 0.0),
            );
            let ok = unsafe {
                CGRectMakeWithDictionaryRepresentation(
                    bounds_val.as_CFTypeRef() as *const libc::c_void,
                    &mut rect,
                )
            };
            if ok {
                result.insert(wid, rect);
            }
        }
    }

    result
}

fn get_frontmost_window(window_ids: &[u32]) -> Option<u32> {
    let options =
        K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY | K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS;
    let raw = unsafe { CGWindowListCopyWindowInfo(options, 0) };
    if raw.is_null() {
        return None;
    }

    let array: CFArray<CFDictionary<CFString, CFType>> =
        unsafe { CFArray::wrap_under_create_rule(raw as *mut _) };

    let key_number = CFString::new("kCGWindowNumber");
    let key_layer = CFString::new("kCGWindowLayer");

    // CGWindowListCopyWindowInfo returns windows in front-to-back order.
    // Find the first match among our window_ids.
    for i in 0..array.len() {
        let dict = unsafe { array.get_unchecked(i) };

        let layer = dict
            .find(&key_layer)
            .and_then(|v| {
                unsafe { CFNumber::wrap_under_get_rule(v.as_CFTypeRef() as *const _) }.to_i64()
            })
            .unwrap_or(-1);

        if layer != 0 {
            continue;
        }

        let wid = match dict.find(&key_number) {
            Some(v) => {
                unsafe { CFNumber::wrap_under_get_rule(v.as_CFTypeRef() as *const _) }
                    .to_i64()
                    .unwrap_or(0) as u32
            }
            None => continue,
        };

        if window_ids.contains(&wid) {
            return Some(wid);
        }
    }

    // Fallback: return the first id
    window_ids.first().copied()
}

// ---------------------------------------------------------------------------
// Overlap / side-by-side detection
// ---------------------------------------------------------------------------

fn rect_overlap_fraction(a: &CGRect, b: &CGRect) -> f64 {
    let left = a.origin.x.max(b.origin.x);
    let top = a.origin.y.max(b.origin.y);
    let right = (a.origin.x + a.size.width).min(b.origin.x + b.size.width);
    let bottom = (a.origin.y + a.size.height).min(b.origin.y + b.size.height);

    if right <= left || bottom <= top {
        return 0.0;
    }

    let intersection = (right - left) * (bottom - top);
    let area_a = a.size.width * a.size.height;
    let area_b = b.size.width * b.size.height;
    let smaller = area_a.min(area_b);

    if smaller <= 0.0 {
        return 0.0;
    }

    intersection / smaller
}

fn are_side_by_side(bounds: &HashMap<u32, CGRect>) -> bool {
    let rects: Vec<&CGRect> = bounds.values().collect();
    for i in 0..rects.len() {
        for j in (i + 1)..rects.len() {
            if rect_overlap_fraction(rects[i], rects[j]) > 0.2 {
                return false;
            }
        }
    }
    true
}

// ---------------------------------------------------------------------------
// Compositing
// ---------------------------------------------------------------------------

fn composite_natural(images_with_bounds: Vec<(CGImage, CGRect)>) -> Option<CGImage> {
    if images_with_bounds.is_empty() {
        return None;
    }

    // Find the bounding rect of all windows
    let mut min_x = f64::MAX;
    let mut min_y = f64::MAX;
    let mut max_x = f64::MIN;
    let mut max_y = f64::MIN;

    for (_, rect) in &images_with_bounds {
        min_x = min_x.min(rect.origin.x);
        min_y = min_y.min(rect.origin.y);
        max_x = max_x.max(rect.origin.x + rect.size.width);
        max_y = max_y.max(rect.origin.y + rect.size.height);
    }

    let total_w = (max_x - min_x).ceil() as usize;
    let total_h = (max_y - min_y).ceil() as usize;

    if total_w == 0 || total_h == 0 {
        return None;
    }

    let cs = CGColorSpace::create_device_rgb();
    let ctx = CGContext::create_bitmap_context(
        None,
        total_w,
        total_h,
        8,
        total_w * 4,
        &cs,
        kCGImageAlphaPremultipliedLast,
    );

    // Fill with dark background (#0d1117)
    ctx.set_rgb_fill_color(
        0x0d as f64 / 255.0,
        0x11 as f64 / 255.0,
        0x17 as f64 / 255.0,
        1.0,
    );
    ctx.fill_rect(CGRect::new(
        &CGPoint::new(0.0, 0.0),
        &CGSize::new(total_w as f64, total_h as f64),
    ));

    // Draw each image at its position.
    // CGContext origin is bottom-left, screen coords are top-left, so flip Y.
    for (image, rect) in &images_with_bounds {
        let x = rect.origin.x - min_x;
        // Flip Y: in screen coords, y increases downward. In CGContext, y increases upward.
        let y = (max_y - min_y) - (rect.origin.y - min_y) - rect.size.height;

        let draw_rect = CGRect::new(
            &CGPoint::new(x, y),
            &CGSize::new(image.width() as f64, image.height() as f64),
        );
        ctx.draw_image(draw_rect, image);
    }

    ctx.create_image()
}

fn composite_horizontal(images: &[CGImage]) -> Option<CGImage> {
    if images.is_empty() {
        return None;
    }

    // Use max height; scale others to match that height
    let max_h = images.iter().map(|img| img.height()).max().unwrap_or(0);
    if max_h == 0 {
        return None;
    }

    // Compute scaled widths
    let mut total_w: usize = 0;
    let mut entries: Vec<(usize, usize)> = Vec::new(); // (scaled_w, max_h)
    for img in images {
        let h = img.height();
        let w = img.width();
        if h == 0 || w == 0 {
            continue;
        }
        let scale = max_h as f64 / h as f64;
        let scaled_w = (w as f64 * scale).ceil() as usize;
        total_w += scaled_w;
        entries.push((scaled_w, max_h));
    }

    if total_w == 0 {
        return None;
    }

    let cs = CGColorSpace::create_device_rgb();
    let ctx = CGContext::create_bitmap_context(
        None,
        total_w,
        max_h,
        8,
        total_w * 4,
        &cs,
        kCGImageAlphaPremultipliedLast,
    );

    // Fill background
    ctx.set_rgb_fill_color(
        0x0d as f64 / 255.0,
        0x11 as f64 / 255.0,
        0x17 as f64 / 255.0,
        1.0,
    );
    ctx.fill_rect(CGRect::new(
        &CGPoint::new(0.0, 0.0),
        &CGSize::new(total_w as f64, max_h as f64),
    ));

    let mut x_offset: f64 = 0.0;
    let mut entry_idx = 0;
    for img in images {
        if img.height() == 0 || img.width() == 0 {
            continue;
        }
        let (scaled_w, _) = entries[entry_idx];
        let draw_rect = CGRect::new(
            &CGPoint::new(x_offset, 0.0),
            &CGSize::new(scaled_w as f64, max_h as f64),
        );
        ctx.draw_image(draw_rect, img);
        x_offset += scaled_w as f64;
        entry_idx += 1;
    }

    ctx.create_image()
}

fn save_cgimage_jpeg(image: &CGImage, path: &Path) {
    if let Ok(jpeg_data) = sources::cgimage_to_jpeg(image) {
        let _ = fs::write(path, jpeg_data);
    }
}

// ---------------------------------------------------------------------------
// Pause / Resume / Stop
// ---------------------------------------------------------------------------

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
                unsafe {
                    libc::kill(pid as i32, libc::SIGSTOP);
                }
            }
        }
        RecordingKind::NativeCapture => {
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
                unsafe {
                    libc::kill(pid as i32, libc::SIGCONT);
                }
            }
        }
        RecordingKind::NativeCapture => {
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
        RecordingKind::NativeCapture => {
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
