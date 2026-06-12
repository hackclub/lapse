use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

pub fn app_data_dir() -> PathBuf {
    let base = dirs::data_local_dir().expect("no local data directory");
    base.join("com.hackclub.lapse.desktop")
}

pub fn read_json<T: DeserializeOwned>(filename: &str) -> Result<Option<T>, String> {
    let path = app_data_dir().join(filename);
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let data = serde_json::from_str(&contents).map_err(|e| e.to_string())?;
    Ok(Some(data))
}

pub fn write_json<T: Serialize>(filename: &str, data: &T) -> Result<(), String> {
    let dir = app_data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(filename);
    let contents = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&path, contents).map_err(|e| e.to_string())
}

pub fn delete_file(filename: &str) -> Result<(), String> {
    let path = app_data_dir().join(filename);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
