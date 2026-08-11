use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

const MAX_REQUEST_BYTES: usize = 8 * 1024;
const MAX_ID_BYTES: usize = 128;

#[derive(Clone)]
struct BridgeStore {
    token: String,
    port: u16,
    views: Arc<Mutex<HashMap<String, Vec<u8>>>>,
}

pub struct ReadModelBridge {
    store: BridgeStore,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadModelEndpoint {
    pub base_url: String,
    pub token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishSessionView {
    pub project_id: String,
    pub session_id: String,
    pub view: Value,
}

impl ReadModelBridge {
    pub fn new() -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|error| format!("Could not start the VS Code read-model bridge: {}", error))?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("Could not inspect the VS Code bridge address: {}", error))?
            .port();
        let store = BridgeStore {
            token: make_token(),
            port,
            views: Arc::new(Mutex::new(HashMap::new())),
        };
        let server_store = store.clone();
        thread::Builder::new()
            .name("promptforge-vscode-bridge".into())
            .spawn(move || serve(listener, server_store))
            .map_err(|error| format!("Could not start the VS Code bridge thread: {}", error))?;
        Ok(Self { store })
    }

    fn endpoint(&self) -> ReadModelEndpoint {
        ReadModelEndpoint {
            base_url: format!("http://127.0.0.1:{}", self.store.port),
            token: self.store.token.clone(),
        }
    }

    fn publish(&self, input: PublishSessionView) -> Result<(), String> {
        validate_id(&input.project_id, "project id")?;
        validate_id(&input.session_id, "session id")?;
        let bytes = serde_json::to_vec(&input.view)
            .map_err(|error| format!("Could not serialize the session read model: {}", error))?;
        let key = format!("{}:{}", input.project_id, input.session_id);
        self.store
            .views
            .lock()
            .map_err(|_| "The VS Code read-model bridge is unavailable.".to_string())?
            .insert(key, bytes);
        Ok(())
    }
}

#[tauri::command]
pub fn vscode_read_model_endpoint(
    state: State<'_, crate::AppState>,
) -> Result<ReadModelEndpoint, String> {
    Ok(state.vscode_bridge.endpoint())
}

#[tauri::command]
pub fn vscode_publish_session_view(
    state: State<'_, crate::AppState>,
    project_id: String,
    session_id: String,
    view: Value,
) -> Result<(), String> {
    state.vscode_bridge.publish(PublishSessionView {
        project_id,
        session_id,
        view,
    })
}

fn validate_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_ID_BYTES
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
    {
        return Err(format!("Invalid {}.", label));
    }
    Ok(())
}

fn make_token() -> String {
    let mut random = [0_u8; 32];
    if let Ok(mut source) = File::open("/dev/urandom") {
        if source.read_exact(&mut random).is_ok() {
            return random.iter().map(|byte| format!("{:02x}", byte)).collect();
        }
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let seed = format!(
        "{}:{}:{}",
        now,
        std::process::id(),
        std::thread::current().name().unwrap_or("main")
    );
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    use std::hash::{Hash, Hasher};
    seed.hash(&mut hash);
    format!("{:016x}{:016x}", hash.finish(), now as u64)
}

fn serve(listener: TcpListener, store: BridgeStore) {
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => handle_connection(stream, &store),
            Err(_) => break,
        }
    }
}

fn handle_connection(mut stream: TcpStream, store: &BridgeStore) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buffer = vec![0_u8; MAX_REQUEST_BYTES];
    let size = match stream.read(&mut buffer) {
        Ok(size) => size,
        Err(_) => return,
    };
    let request = String::from_utf8_lossy(&buffer[..size]);
    let mut lines = request.lines();
    let request_line = lines.next().unwrap_or_default();
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default();
    let path = request_parts.next().unwrap_or_default();
    let authorized = lines.any(|line| {
        let mut parts = line.splitn(2, ':');
        parts
            .next()
            .map(str::trim)
            .unwrap_or_default()
            .eq_ignore_ascii_case("authorization")
            && parts.next().map(str::trim).unwrap_or_default() == format!("Bearer {}", store.token)
    });
    if method != "GET" {
        write_response(&mut stream, 405, "Method Not Allowed", b"{}");
        return;
    }
    if !authorized {
        write_response(&mut stream, 401, "Unauthorized", b"{}");
        return;
    }
    let Some((project_id, session_id)) = parse_path(path) else {
        write_response(&mut stream, 404, "Not Found", b"{}");
        return;
    };
    let key = format!("{}:{}", project_id, session_id);
    let body = store
        .views
        .lock()
        .ok()
        .and_then(|views| views.get(&key).cloned());
    match body {
        Some(body) => write_response(&mut stream, 200, "OK", &body),
        None => write_response(&mut stream, 404, "Not Found", b"{}"),
    }
}

fn parse_path(path: &str) -> Option<(&str, &str)> {
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() != 5 || parts[1] != "v1" || parts[2] != "session-views" {
        return None;
    }
    validate_id(parts[3], "project id").ok()?;
    validate_id(parts[4], "session id").ok()?;
    Some((parts[3], parts[4]))
}

fn write_response(stream: &mut TcpStream, status: u16, reason: &str, body: &[u8]) {
    let header = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status, reason, body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_path_safe() {
        assert!(validate_id("project-1", "project id").is_ok());
        assert!(validate_id("../other", "project id").is_err());
        assert!(parse_path("/v1/session-views/project-1/session-1").is_some());
        assert!(parse_path("/v1/session-views/project-1/../session-1").is_none());
    }

    #[test]
    fn bridge_publishes_only_json_by_project_and_session_key() {
        let bridge = ReadModelBridge {
            store: BridgeStore {
                token: "test-token".into(),
                port: 0,
                views: Arc::new(Mutex::new(HashMap::new())),
            },
        };
        bridge
            .publish(PublishSessionView {
                project_id: "project-1".into(),
                session_id: "session-1".into(),
                view: serde_json::json!({"status":"active"}),
            })
            .expect("publish succeeds");
        let body = bridge
            .store
            .views
            .lock()
            .expect("store lock")
            .get("project-1:session-1")
            .cloned();
        assert_eq!(body, Some(br#"{"status":"active"}"#.to_vec()));
    }
}
