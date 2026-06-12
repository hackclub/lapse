use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;

use crate::storage;

#[derive(Serialize, Deserialize, Clone)]
pub struct StashedTimelapse {
    pub session_id: String,
    pub created_at: u64,
    pub frame_count: u32,
    pub elapsed_seconds: f64,
    pub output_path: String,
    pub thumbnail_path: String,
    pub snapshots: Vec<u64>,
}

const STASHES_FILE: &str = "stashes.json";

#[tauri::command]
pub fn stash_save(stash: StashedTimelapse) -> Result<(), String> {
    let mut stashes = load_stashes();
    stashes.retain(|s| s.session_id != stash.session_id);
    stashes.insert(0, stash);
    storage::write_json(STASHES_FILE, &stashes)
}

#[tauri::command]
pub fn stash_list() -> Result<Vec<StashedTimelapse>, String> {
    Ok(load_stashes())
}

#[tauri::command]
pub fn stash_remove(session_id: String) -> Result<(), String> {
    let mut stashes = load_stashes();
    stashes.retain(|s| s.session_id != session_id);
    storage::write_json(STASHES_FILE, &stashes)?;
    cleanup_session_dir(&session_id);
    Ok(())
}

fn load_stashes() -> Vec<StashedTimelapse> {
    storage::read_json::<Vec<StashedTimelapse>>(STASHES_FILE)
        .ok()
        .flatten()
        .unwrap_or_default()
}

fn cleanup_session_dir(session_id: &str) {
    let session_dir = storage::app_data_dir()
        .join("sessions")
        .join(session_id);
    if session_dir.exists() {
        let _ = fs::remove_dir_all(&session_dir);
    }
}

#[tauri::command]
pub fn get_file_size(path: String) -> Result<u64, String> {
    fs::metadata(&path).map_err(|e| e.to_string()).map(|m| m.len())
}

#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(&bytes))
}

#[tauri::command]
pub fn cleanup_session(session_id: String) -> Result<(), String> {
    let session_dir = storage::app_data_dir()
        .join("sessions")
        .join(&session_id);
    if session_dir.exists() {
        fs::remove_dir_all(&session_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
