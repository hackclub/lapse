use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::storage;

#[derive(Serialize, Deserialize, Clone)]
pub struct LocalDevice {
    pub id: String,
    pub passkey: String,
}

#[tauri::command]
pub fn device_get() -> Result<Option<LocalDevice>, String> {
    storage::read_json("device.json")
}

#[tauri::command]
pub fn device_save(id: String, passkey: String) -> Result<(), String> {
    storage::write_json("device.json", &LocalDevice { id, passkey })
}

#[tauri::command]
pub fn device_generate_passkey() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}
