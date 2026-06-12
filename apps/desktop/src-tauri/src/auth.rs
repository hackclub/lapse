use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::Rng;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::Duration;

use crate::storage;

const CLIENT_ID: &str = "svc_85fdbf6c38dd4a6abbd9d002";
const REDIRECT_URI: &str = "http://localhost:8765/auth/callback";
const SCOPE: &str = "elevated";
const API_URL: &str = "https://api.lapse.hackclub.com";

struct OAuthSession {
    state: String,
    code_verifier: String,
}

pub struct AuthState {
    session: Mutex<Option<OAuthSession>>,
}

impl AuthState {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
        }
    }
}

fn generate_random_hex(bytes: usize) -> String {
    let mut rng = rand::thread_rng();
    let random_bytes: Vec<u8> = (0..bytes).map(|_| rng.gen()).collect();
    random_bytes
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

fn generate_code_challenge(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}

#[derive(Serialize)]
pub struct AuthInitiateResponse {
    authorize_url: String,
}

#[derive(Serialize)]
pub struct AuthCallbackResponse {
    code: String,
    code_verifier: String,
}

#[tauri::command]
pub fn auth_initiate(state: tauri::State<'_, AuthState>) -> Result<AuthInitiateResponse, String> {
    let code_verifier = generate_random_hex(32);
    let code_challenge = generate_code_challenge(&code_verifier);
    let oauth_state = generate_random_hex(16);

    let authorize_url = format!(
        "{}/api/auth/authorize?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        API_URL,
        CLIENT_ID,
        urlencoding::encode(REDIRECT_URI),
        urlencoding::encode(SCOPE),
        &oauth_state,
        &code_challenge
    );

    let mut session = state.session.lock().map_err(|e| e.to_string())?;
    *session = Some(OAuthSession {
        state: oauth_state,
        code_verifier,
    });

    Ok(AuthInitiateResponse { authorize_url })
}

#[tauri::command]
pub async fn auth_await_callback(
    state: tauri::State<'_, AuthState>,
) -> Result<AuthCallbackResponse, String> {
    let listener =
        TcpListener::bind("127.0.0.1:8765").map_err(|e| format!("Failed to bind: {}", e))?;

    listener
        .set_nonblocking(false)
        .map_err(|e| e.to_string())?;

    // Set a timeout so we don't block forever
    listener
        .incoming()
        .next()
        .ok_or("No connection received")?
        .map_err(|e| format!("Accept failed: {}", e))
        .and_then(|mut stream| {
            stream
                .set_read_timeout(Some(Duration::from_secs(120)))
                .map_err(|e| e.to_string())?;

            let mut buf = [0u8; 4096];
            let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
            let request = String::from_utf8_lossy(&buf[..n]);

            let first_line = request.lines().next().unwrap_or("");
            let path = first_line.split_whitespace().nth(1).unwrap_or("");

            let query = path.split('?').nth(1).unwrap_or("");
            let params: std::collections::HashMap<&str, &str> = query
                .split('&')
                .filter_map(|pair| {
                    let mut parts = pair.splitn(2, '=');
                    Some((parts.next()?, parts.next()?))
                })
                .collect();

            let code = params
                .get("code")
                .ok_or("No code in callback")?
                .to_string();
            let callback_state = params
                .get("state")
                .ok_or("No state in callback")?
                .to_string();

            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body><h2>Authentication successful!</h2><p>You may close this window and return to Lapse.</p></body></html>";
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();

            let session_guard = state.session.lock().map_err(|e| e.to_string())?;
            let session = session_guard
                .as_ref()
                .ok_or("No OAuth session in progress")?;

            if callback_state != session.state {
                return Err("State mismatch".to_string());
            }

            Ok(AuthCallbackResponse {
                code,
                code_verifier: session.code_verifier.clone(),
            })
        })
}

#[derive(serde::Deserialize, Serialize)]
struct StoredAuth {
    access_token: String,
}

#[tauri::command]
pub fn auth_get_token() -> Result<Option<String>, String> {
    let auth: Option<StoredAuth> = storage::read_json("auth.json")?;
    Ok(auth.map(|a| a.access_token))
}

#[tauri::command]
pub fn auth_set_token(token: String) -> Result<(), String> {
    storage::write_json("auth.json", &StoredAuth { access_token: token })
}

#[tauri::command]
pub fn auth_clear_token() -> Result<(), String> {
    storage::delete_file("auth.json")
}
