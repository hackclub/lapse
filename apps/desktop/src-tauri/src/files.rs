use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use std::fs;

use crate::storage;

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
