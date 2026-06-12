mod auth;
mod device;
mod encoding;
mod files;
mod recording;
mod sources;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(auth::AuthState::new())
        .manage(recording::RecordingManager::new())
        .manage(sources::ThumbnailStreamManager::new())
        .invoke_handler(tauri::generate_handler![
            auth::auth_initiate,
            auth::auth_await_callback,
            auth::auth_get_token,
            auth::auth_set_token,
            auth::auth_clear_token,
            sources::enumerate_sources,
            sources::enumerate_cameras,
            sources::enumerate_windows_cmd,
            sources::check_ffmpeg_available,
            sources::thumbnail_stream_start,
            sources::thumbnail_stream_stop,
            sources::thumbnail_stream_stop_all,
            recording::recording_start,
            recording::recording_pause,
            recording::recording_resume,
            recording::recording_stop,
            recording::recording_tick_snapshot,
            recording::recording_get_latest_frame,
            recording::recording_get_elapsed,
            recording::recording_get_phase,
            encoding::encode_session,
            device::device_get,
            device::device_save,
            device::device_generate_passkey,
            files::get_file_size,
            files::read_file_bytes,
            files::cleanup_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
