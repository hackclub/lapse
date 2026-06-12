use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use core_foundation::array::CFArray;
use core_foundation::base::{CFType, TCFType};
use core_graphics::base::kCGImageAlphaPremultipliedLast;
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::color_space::CGColorSpace;
use core_graphics::context::CGContext;
use core_graphics::display::CGDisplay;
use core_graphics::geometry::{CGPoint, CGRect, CGSize};
use core_graphics::image::CGImage;
use core_graphics::window::{
    create_image, kCGWindowImageBoundsIgnoreFraming, kCGWindowImageNominalResolution,
    kCGWindowListOptionIncludingWindow,
};
use foreign_types::ForeignType;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

extern "C" {
    fn proc_pidpath(pid: i32, buffer: *mut u8, buffersize: u32) -> i32;
}

#[link(name = "objc")]
extern "C" {
    fn objc_getClass(name: *const libc::c_char) -> *mut libc::c_void;
    fn sel_registerName(name: *const libc::c_char) -> *mut libc::c_void;
    fn objc_msgSend();
}

extern "C" {
    fn CGWindowListCopyWindowInfo(
        option: u32,
        relative_to_window: u32,
    ) -> core_foundation::base::CFTypeRef;

    static CGRectNull: core_graphics::geometry::CGRect;
}

extern "C" {
    fn CFDataCreateMutable(allocator: *const libc::c_void, capacity: isize) -> *mut libc::c_void;
    fn CFDataGetBytePtr(data: *const libc::c_void) -> *const u8;
    fn CFDataGetLength(data: *const libc::c_void) -> isize;
    fn CFRelease(cf: *const libc::c_void);

    fn CGImageDestinationCreateWithData(
        data: *mut libc::c_void,
        type_: *const libc::c_void,
        count: usize,
        options: *const libc::c_void,
    ) -> *mut libc::c_void;
    fn CGImageDestinationAddImage(
        dest: *mut libc::c_void,
        image: *const libc::c_void,
        properties: *const libc::c_void,
    );
    fn CGImageDestinationFinalize(dest: *mut libc::c_void) -> bool;
}

const K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1 << 0;
const K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS: u32 = 1 << 4;
const THUMB_MAX_WIDTH: usize = 320;

#[derive(Serialize, Clone)]
pub struct CaptureSource {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

struct StreamHandle {
    stop: Arc<AtomicBool>,
}

pub struct ThumbnailStreamManager {
    streams: Mutex<HashMap<String, StreamHandle>>,
}

impl ThumbnailStreamManager {
    pub fn new() -> Self {
        Self {
            streams: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Serialize, Clone)]
struct ThumbnailFrame {
    source_id: String,
    data: String,
}

pub fn capture_source_image(source_id: &str, source_kind: &str, _source_name: &str) -> Option<CGImage> {
    match source_kind {
        "Screen" => {
            let screen_num = parse_screen_number(source_id)?;
            let displays = CGDisplay::active_displays().ok()?;
            let display_id = displays.get(screen_num as usize)?;
            CGDisplay::new(*display_id).image()
        }
        "Window" => {
            let window_id: u32 = source_id.parse().ok()?;
            let bounds = unsafe { CGRectNull };
            create_image(
                bounds,
                kCGWindowListOptionIncludingWindow,
                window_id,
                kCGWindowImageBoundsIgnoreFraming | kCGWindowImageNominalResolution,
            )
        }
        _ => None,
    }
}

fn scale_image(image: &CGImage, max_width: usize) -> Option<CGImage> {
    let orig_w = image.width();
    let orig_h = image.height();
    if orig_w == 0 || orig_h == 0 {
        return None;
    }

    let scale = (max_width as f64) / (orig_w as f64);
    if scale >= 1.0 {
        return Some(image.clone());
    }

    let new_w = max_width;
    let new_h = ((orig_h as f64) * scale) as usize;
    if new_w == 0 || new_h == 0 {
        return None;
    }

    let cs = CGColorSpace::create_device_rgb();
    let ctx = CGContext::create_bitmap_context(
        None,
        new_w,
        new_h,
        8,
        0,
        &cs,
        kCGImageAlphaPremultipliedLast,
    );

    let rect = CGRect::new(&CGPoint::new(0.0, 0.0), &CGSize::new(new_w as f64, new_h as f64));
    ctx.draw_image(rect, image);
    ctx.create_image()
}

fn capture_and_encode(source_id: &str, source_kind: &str, source_name: &str) -> Option<String> {
    let image = capture_source_image(source_id, source_kind, source_name)?;
    let thumb = scale_image(&image, THUMB_MAX_WIDTH)?;
    let jpeg = cgimage_to_jpeg(&thumb).ok()?;
    let b64 = STANDARD.encode(&jpeg);
    Some(format!("data:image/jpeg;base64,{}", b64))
}

#[tauri::command]
pub fn thumbnail_stream_start(
    source_id: String,
    source_kind: String,
    source_name: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, ThumbnailStreamManager>,
) -> Result<(), String> {
    let mut streams = state.streams.lock().map_err(|e| e.to_string())?;

    if streams.contains_key(&source_id) {
        return Ok(());
    }

    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = Arc::clone(&stop);
    let sid = source_id.clone();
    let skind = source_kind.clone();
    let sname = source_name.clone();

    let stream_index = streams.len() as u64;
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(stream_index * 150));

        while !stop_clone.load(Ordering::Relaxed) {
            if let Some(data_uri) = capture_and_encode(&sid, &skind, &sname) {
                let _ = app_handle.emit(
                    "thumbnail:frame",
                    ThumbnailFrame {
                        source_id: sid.clone(),
                        data: data_uri,
                    },
                );
            }
            std::thread::sleep(Duration::from_millis(1000));
        }
    });

    streams.insert(source_id, StreamHandle { stop });
    Ok(())
}

#[tauri::command]
pub fn thumbnail_stream_stop(
    source_id: String,
    state: tauri::State<'_, ThumbnailStreamManager>,
) -> Result<(), String> {
    let mut streams = state.streams.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = streams.remove(&source_id) {
        handle.stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub fn thumbnail_stream_stop_all(
    state: tauri::State<'_, ThumbnailStreamManager>,
) -> Result<(), String> {
    let mut streams = state.streams.lock().map_err(|e| e.to_string())?;
    for (_, handle) in streams.drain() {
        handle.stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}

fn get_display_name_map() -> HashMap<u32, String> {
    type Send = unsafe extern "C" fn(*mut libc::c_void, *mut libc::c_void) -> *mut libc::c_void;
    type SendIdx = unsafe extern "C" fn(*mut libc::c_void, *mut libc::c_void, usize) -> *mut libc::c_void;
    type SendObj = unsafe extern "C" fn(*mut libc::c_void, *mut libc::c_void, *const libc::c_void) -> *mut libc::c_void;

    let mut map = HashMap::new();
    unsafe {
        let send: Send = std::mem::transmute(objc_msgSend as *const ());
        let send_idx: SendIdx = std::mem::transmute(objc_msgSend as *const ());
        let send_obj: SendObj = std::mem::transmute(objc_msgSend as *const ());

        let ns_screen = objc_getClass(b"NSScreen\0".as_ptr() as *const _);
        if ns_screen.is_null() { return map; }

        let screens = send(ns_screen, sel_registerName(b"screens\0".as_ptr() as *const _));
        if screens.is_null() { return map; }

        let count = send(screens, sel_registerName(b"count\0".as_ptr() as *const _)) as usize;

        let obj_at_idx = sel_registerName(b"objectAtIndex:\0".as_ptr() as *const _);
        let localized_name_sel = sel_registerName(b"localizedName\0".as_ptr() as *const _);
        let utf8_sel = sel_registerName(b"UTF8String\0".as_ptr() as *const _);
        let device_desc_sel = sel_registerName(b"deviceDescription\0".as_ptr() as *const _);
        let obj_for_key_sel = sel_registerName(b"objectForKey:\0".as_ptr() as *const _);
        let uint_val_sel = sel_registerName(b"unsignedIntValue\0".as_ptr() as *const _);

        let screen_number_key = CFString::new("NSScreenNumber");
        let screen_number_key_ptr = screen_number_key.as_concrete_TypeRef() as *const libc::c_void;

        for i in 0..count {
            let screen = send_idx(screens, obj_at_idx, i);
            if screen.is_null() { continue; }

            let name_obj = send(screen, localized_name_sel);
            if name_obj.is_null() { continue; }
            let name_cstr = send(name_obj, utf8_sel) as *const libc::c_char;
            if name_cstr.is_null() { continue; }
            let name = std::ffi::CStr::from_ptr(name_cstr).to_string_lossy().to_string();

            let desc = send(screen, device_desc_sel);
            if desc.is_null() { continue; }
            let num_obj = send_obj(desc, obj_for_key_sel, screen_number_key_ptr);
            if num_obj.is_null() { continue; }
            let display_id = send(num_obj, uint_val_sel) as u32;

            map.insert(display_id, name);
        }
    }
    map
}

#[tauri::command]
pub fn enumerate_sources() -> Result<Vec<CaptureSource>, String> {
    let displays = CGDisplay::active_displays()
        .map_err(|e| format!("Failed to enumerate displays: {:?}", e))?;
    let names = get_display_name_map();
    Ok(displays
        .iter()
        .enumerate()
        .map(|(i, display_id)| {
            let name = names.get(display_id)
                .cloned()
                .unwrap_or_else(|| format!("Display {}", i + 1));
            CaptureSource {
                id: format!("Capture screen {}", i),
                name,
                kind: "Screen".to_string(),
                icon: None,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn enumerate_cameras() -> Result<Vec<CaptureSource>, String> {
    tokio::task::spawn_blocking(enumerate_cameras_sync)
        .await
        .map_err(|e| e.to_string())?
}

fn enumerate_cameras_sync() -> Result<Vec<CaptureSource>, String> {
    let output = Command::new("ffmpeg")
        .args(["-f", "avfoundation", "-list_devices", "true", "-i", "dummy"])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}. Is ffmpeg installed?", e))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut sources = Vec::new();
    let mut in_video_section = false;

    for line in stderr.lines() {
        if line.contains("AVFoundation video devices:") {
            in_video_section = true;
            continue;
        }
        if line.contains("AVFoundation audio devices:") {
            break;
        }
        if !in_video_section {
            continue;
        }

        if let Some(bracket_start) = line.rfind('[') {
            let after_bracket = &line[bracket_start + 1..];
            if let Some(bracket_end) = after_bracket.find(']') {
                let id = after_bracket[..bracket_end].trim().to_string();
                let name = after_bracket[bracket_end + 1..].trim().to_string();
                if name.is_empty() || name.to_lowercase().contains("capture screen") {
                    continue;
                }

                sources.push(CaptureSource {
                    id,
                    name,
                    kind: "Camera".to_string(),
                    icon: None,
                });
            }
        }
    }

    Ok(sources)
}

#[tauri::command]
pub async fn enumerate_windows_cmd() -> Result<Vec<CaptureSource>, String> {
    tokio::task::spawn_blocking(enumerate_windows)
        .await
        .map_err(|e| e.to_string())
}

fn get_app_bundle_from_pid(pid: i32) -> Option<PathBuf> {
    let mut buf = vec![0u8; 4096];
    let len = unsafe { proc_pidpath(pid, buf.as_mut_ptr(), buf.len() as u32) };
    if len <= 0 {
        return None;
    }
    let path = PathBuf::from(String::from_utf8_lossy(&buf[..len as usize]).to_string());
    let mut current = path.as_path();
    loop {
        if current.extension().map(|e| e == "app").unwrap_or(false) {
            return Some(current.to_path_buf());
        }
        match current.parent() {
            Some(p) if p != current => current = p,
            _ => return None,
        }
    }
}

fn get_app_icon(bundle: &Path) -> Option<String> {
    let info_plist = bundle.join("Contents/Info.plist");
    if !info_plist.exists() {
        return None;
    }

    let output = Command::new("defaults")
        .args(["read", &bundle.join("Contents/Info").to_string_lossy(), "CFBundleIconFile"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let mut icon_name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if icon_name.is_empty() {
        return None;
    }
    if !icon_name.ends_with(".icns") {
        icon_name.push_str(".icns");
    }

    let icon_path = bundle.join("Contents/Resources").join(&icon_name);
    if !icon_path.exists() {
        return None;
    }

    let hash = icon_path.to_string_lossy().len();
    let temp_path = format!("/tmp/lapse-icon-{}.png", hash);

    let sips = Command::new("sips")
        .args([
            "-s", "format", "png",
            "--resampleWidth", "64",
            &icon_path.to_string_lossy(),
            "--out", &temp_path,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .ok()?;

    if !sips.success() {
        return None;
    }

    let bytes = fs::read(&temp_path).ok()?;
    let _ = fs::remove_file(&temp_path);
    Some(format!("data:image/png;base64,{}", STANDARD.encode(&bytes)))
}

fn enumerate_windows() -> Vec<CaptureSource> {
    let mut results = Vec::new();
    let mut icon_cache: HashMap<i64, Option<String>> = HashMap::new();

    let options =
        K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY | K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS;
    let raw = unsafe { CGWindowListCopyWindowInfo(options, 0) };
    if raw.is_null() {
        return results;
    }

    let array: CFArray<CFDictionary<CFString, CFType>> =
        unsafe { CFArray::wrap_under_create_rule(raw as *mut _) };

    let own_pid = std::process::id() as i64;

    let key_name = CFString::new("kCGWindowName");
    let key_owner = CFString::new("kCGWindowOwnerName");
    let key_number = CFString::new("kCGWindowNumber");
    let key_layer = CFString::new("kCGWindowLayer");
    let key_pid = CFString::new("kCGWindowOwnerPID");

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

        let pid = dict
            .find(&key_pid)
            .and_then(|v| {
                unsafe { CFNumber::wrap_under_get_rule(v.as_CFTypeRef() as *const _) }.to_i64()
            })
            .unwrap_or(0);

        if pid == own_pid {
            continue;
        }

        let name = match dict.find(&key_name) {
            Some(v) => {
                let s = unsafe { CFString::wrap_under_get_rule(v.as_CFTypeRef() as *const _) };
                s.to_string()
            }
            None => continue,
        };

        if name.is_empty() {
            continue;
        }

        let owner = dict
            .find(&key_owner)
            .map(|v| {
                let s = unsafe { CFString::wrap_under_get_rule(v.as_CFTypeRef() as *const _) };
                s.to_string()
            })
            .unwrap_or_default();

        let window_id = dict
            .find(&key_number)
            .and_then(|v| {
                unsafe { CFNumber::wrap_under_get_rule(v.as_CFTypeRef() as *const _) }.to_i64()
            })
            .unwrap_or(0);

        let icon = icon_cache.entry(pid).or_insert_with(|| {
            get_app_bundle_from_pid(pid as i32).and_then(|b| get_app_icon(&b))
        }).clone();

        results.push(CaptureSource {
            id: window_id.to_string(),
            name: format!("{} — {}", owner, name),
            kind: "Window".to_string(),
            icon,
        });
    }

    results
}

pub fn parse_screen_number(source_name: &str) -> Option<u32> {
    source_name
        .to_lowercase()
        .strip_prefix("capture screen ")
        .and_then(|n| n.trim().parse().ok())
}

pub fn cgimage_to_jpeg(image: &CGImage) -> Result<Vec<u8>, String> {
    unsafe {
        let data = CFDataCreateMutable(ptr::null(), 0);
        if data.is_null() {
            return Err("Failed to create mutable data".to_string());
        }

        let jpeg_uti = CFString::new("public.jpeg");
        let dest = CGImageDestinationCreateWithData(
            data,
            jpeg_uti.as_concrete_TypeRef() as *const libc::c_void,
            1,
            ptr::null(),
        );
        if dest.is_null() {
            CFRelease(data as *const _);
            return Err("Failed to create image destination".to_string());
        }

        CGImageDestinationAddImage(dest, image.as_ptr() as *const libc::c_void, ptr::null());

        let ok = CGImageDestinationFinalize(dest);
        CFRelease(dest as *const _);

        if !ok {
            CFRelease(data as *const _);
            return Err("Failed to encode JPEG".to_string());
        }

        let byte_ptr = CFDataGetBytePtr(data as *const _);
        let length = CFDataGetLength(data as *const _) as usize;
        let bytes = std::slice::from_raw_parts(byte_ptr, length).to_vec();
        CFRelease(data as *const _);
        Ok(bytes)
    }
}

pub fn capture_source_to_jpeg(source_id: &str, source_kind: &str, source_name: &str) -> Option<Vec<u8>> {
    let img = capture_source_image(source_id, source_kind, source_name)?;
    cgimage_to_jpeg(&img).ok()
}

#[tauri::command]
pub async fn check_ffmpeg_available() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let output = Command::new("ffmpeg")
            .arg("-version")
            .output()
            .map_err(|e| format!("ffmpeg not found: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let first_line = stdout.lines().next().unwrap_or("unknown version");
        Ok(first_line.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
