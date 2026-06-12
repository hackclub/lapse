use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::Emitter;

use crate::storage;

fn get_jpeg_dimensions(path: &PathBuf) -> Result<(u32, u32), String> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0",
        ])
        .arg(path.to_string_lossy().as_ref())
        .output()
        .map_err(|e| format!("ffprobe failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = stdout.trim().split(',').collect();
    if parts.len() != 2 {
        return Err("Could not parse dimensions from ffprobe".to_string());
    }

    let width: u32 = parts[0].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
    let height: u32 = parts[1].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
    Ok((width, height))
}

fn round_even(n: u32) -> u32 {
    if n % 2 == 0 { n } else { n + 1 }
}

#[derive(Serialize)]
pub struct EncodeResult {
    pub output_path: String,
    pub thumbnail_path: String,
    pub file_size: u64,
    pub thumbnail_size: u64,
    pub frame_count: u32,
}

#[tauri::command]
pub fn encode_session(
    session_id: String,
    app_handle: tauri::AppHandle,
) -> Result<EncodeResult, String> {
    let session_dir = storage::app_data_dir()
        .join("sessions")
        .join(&session_id);
    let frames_dir = session_dir.join("frames");

    let frame_count = fs::read_dir(&frames_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "jpg")
                .unwrap_or(false)
        })
        .count() as u32;

    if frame_count == 0 {
        return Err("No frames captured".to_string());
    }

    let first_frame = frames_dir.join("frame-000001.jpg");
    let (w, h) = get_jpeg_dimensions(&first_frame)?;
    let w = round_even(w);
    let h = round_even(h);

    let input_pattern = frames_dir
        .join("frame-%06d.jpg")
        .to_string_lossy()
        .to_string();
    let output_path = session_dir.join("output.mp4");
    let output_str = output_path.to_string_lossy().to_string();

    let vf = format!(
        "scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:black",
        w, h, w, h
    );

    let mut child = Command::new("ffmpeg")
        .args([
            "-y",
            "-framerate",
            "24",
            "-i",
            &input_pattern,
            "-vf",
            &vf,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            &output_str,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg encode: {}", e))?;

    // Parse progress from stderr
    if let Some(stderr) = child.stderr.take() {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                if line.starts_with("frame=") || line.contains("frame=") {
                    if let Some(frame_str) = line
                        .split("frame=")
                        .nth(1)
                        .and_then(|s| s.trim().split_whitespace().next())
                    {
                        if let Ok(current_frame) = frame_str.parse::<u32>() {
                            let progress = (current_frame as f64) / (frame_count as f64);
                            let _ = app_handle.emit("encoding:progress", progress.min(1.0));
                        }
                    }
                }
            }
        }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("FFmpeg encoding failed".to_string());
    }

    // Generate thumbnail from first frame
    let thumbnail_path = session_dir.join("thumbnail.jpg");
    let thumb_status = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            &first_frame.to_string_lossy(),
            "-vf",
            "scale=1280:-1",
            &thumbnail_path.to_string_lossy(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Thumbnail generation failed: {}", e))?;

    if !thumb_status.success() {
        return Err("Thumbnail generation failed".to_string());
    }

    let file_size = fs::metadata(&output_path)
        .map_err(|e| e.to_string())?
        .len();
    let thumbnail_size = fs::metadata(&thumbnail_path)
        .map_err(|e| e.to_string())?
        .len();

    let _ = app_handle.emit("encoding:progress", 1.0);

    Ok(EncodeResult {
        output_path: output_str,
        thumbnail_path: thumbnail_path.to_string_lossy().to_string(),
        file_size,
        thumbnail_size,
        frame_count,
    })
}
