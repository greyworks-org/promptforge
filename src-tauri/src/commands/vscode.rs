use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
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
    handoff_views: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    actions: Arc<Mutex<VecDeque<SessionAction>>>,
    results: Arc<Mutex<HashMap<String, SessionActionResult>>>,
    next_action_id: Arc<AtomicU64>,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VscodeBridgeStatus {
    pub available: bool,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VscodeLaunchResult {
    pub project_root: String,
    pub application: String,
}

/// Open the exact registered project root with the native VS Code application.
/// This avoids webview custom-protocol navigation and never accepts a caller-supplied root.
#[tauri::command]
pub fn open_vscode(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<VscodeLaunchResult, String> {
    let root = crate::commands::fs::resolve_project_root(&app, &project_id)?;
    let root_text = root.to_string_lossy().into_owned();

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("/usr/bin/open")
            .args(["-a", "Visual Studio Code", &root_text])
            .output()
            .map_err(|error| format!("VS Code could not be opened: {}", error))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if detail.is_empty() {
                "Visual Studio Code is not installed or could not be opened. Install VS Code or make it available to macOS Launch Services.".into()
            } else {
                format!("VS Code could not be opened: {}", detail)
            });
        }
        return Ok(VscodeLaunchResult { project_root: root_text, application: "Visual Studio Code".into() });
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Native VS Code launch is currently supported on macOS only.".into())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishSessionView {
    pub project_id: String,
    pub session_id: String,
    pub view: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishHandoffView {
    pub project_id: String,
    pub session_id: String,
    pub view: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAction {
    pub id: String,
    pub project_id: String,
    pub session_id: String,
    pub action: String,
    pub note: Option<String>,
    pub payload: Option<Value>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionActionResult {
    pub status: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionActionRequest {
    project_id: String,
    session_id: String,
    action: String,
    note: Option<String>,
    payload: Option<Value>,
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
            handoff_views: Arc::new(Mutex::new(HashMap::new())),
            actions: Arc::new(Mutex::new(VecDeque::new())),
            results: Arc::new(Mutex::new(HashMap::new())),
            next_action_id: Arc::new(AtomicU64::new(1)),
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

    fn queue_action(&self, input: SessionActionRequest) -> Result<SessionAction, String> {
        validate_id(&input.project_id, "project id")?;
        validate_id(&input.session_id, "session id")?;
        if !matches!(input.action.as_str(), "start" | "resume" | "checkpoint" | "model" | "handoff-context" | "handoff-preview" | "handoff-confirm") {
            return Err("Unsupported VS Code session action.".into());
        }
        if input.note.as_ref().is_some_and(|note| note.len() > 4000) {
            return Err("Checkpoint note is too long.".into());
        }
        if input.action == "checkpoint"
            && input.note.as_deref().unwrap_or_default().trim().is_empty()
        {
            return Err("A non-empty checkpoint note is required.".into());
        }
        let action = SessionAction {
            id: format!(
                "action-{}",
                self.store.next_action_id.fetch_add(1, Ordering::Relaxed)
            ),
            project_id: input.project_id,
            session_id: input.session_id,
            action: input.action,
            note: input.note,
            payload: input.payload,
        };
        self.store
            .actions
            .lock()
            .map_err(|_| "The VS Code action bridge is unavailable.".to_string())?
            .push_back(action.clone());
        Ok(action)
    }

    fn take_action(&self) -> Result<Option<SessionAction>, String> {
        self.store
            .actions
            .lock()
            .map_err(|_| "The VS Code action bridge is unavailable.".to_string())
            .map(|mut actions| actions.pop_front())
    }

    fn publish_handoff(&self, input: PublishHandoffView) -> Result<(), String> {
        validate_id(&input.project_id, "project id")?;
        validate_id(&input.session_id, "session id")?;
        let bytes = serde_json::to_vec(&input.view)
            .map_err(|error| format!("Could not serialize the VS Code handoff view: {}", error))?;
        let key = format!("{}:{}", input.project_id, input.session_id);
        self.store
            .handoff_views
            .lock()
            .map_err(|_| "The VS Code handoff bridge is unavailable.".to_string())?
            .insert(key, bytes);
        Ok(())
    }

    fn complete_action(
        &self,
        action_id: String,
        success: bool,
        message: String,
    ) -> Result<(), String> {
        validate_id(&action_id, "action id")?;
        if message.len() > 1000 {
            return Err("Session action result is too long.".into());
        }
        self.store
            .results
            .lock()
            .map_err(|_| "The VS Code action bridge is unavailable.".to_string())?
            .insert(
                action_id,
                SessionActionResult {
                    status: if success {
                        "succeeded".into()
                    } else {
                        "failed".into()
                    },
                    message,
                },
            );
        Ok(())
    }
}

/// The read-model bridge is an optional presentation/control transport. A
/// socket permission failure must not prevent the core app from starting.
pub fn optional_bridge() -> (Option<ReadModelBridge>, Option<String>) {
    optional_bridge_from(ReadModelBridge::new())
}

fn optional_bridge_from(result: Result<ReadModelBridge, String>) -> (Option<ReadModelBridge>, Option<String>) {
    match result {
        Ok(bridge) => (Some(bridge), None),
        Err(error) => {
            eprintln!("VS Code read-model bridge unavailable: {}", error);
            (None, Some(error))
        }
    }
}

fn bridge<'a>(state: &'a State<'_, crate::AppState>) -> Result<&'a ReadModelBridge, String> {
    state.vscode_bridge.as_ref().ok_or_else(|| {
        state
            .vscode_bridge_error
            .clone()
            .unwrap_or_else(|| "The VS Code read-model bridge is unavailable.".into())
    })
}

#[tauri::command]
pub fn vscode_read_model_endpoint(
    state: State<'_, crate::AppState>,
) -> Result<ReadModelEndpoint, String> {
    Ok(bridge(&state)?.endpoint())
}

#[tauri::command]
pub fn vscode_bridge_status(
    state: State<'_, crate::AppState>,
) -> VscodeBridgeStatus {
    VscodeBridgeStatus {
        available: state.vscode_bridge.is_some(),
        message: state.vscode_bridge_error.clone(),
    }
}

#[tauri::command]
pub fn vscode_publish_session_view(
    state: State<'_, crate::AppState>,
    project_id: String,
    session_id: String,
    view: Value,
) -> Result<(), String> {
    bridge(&state)?.publish(PublishSessionView {
        project_id,
        session_id,
        view,
    })
}

#[tauri::command]
pub fn vscode_publish_handoff_view(
    state: State<'_, crate::AppState>,
    project_id: String,
    session_id: String,
    view: Value,
) -> Result<(), String> {
    bridge(&state)?.publish_handoff(PublishHandoffView { project_id, session_id, view })
}

#[tauri::command]
pub fn vscode_take_session_action(
    state: State<'_, crate::AppState>,
) -> Result<Option<SessionAction>, String> {
    bridge(&state)?.take_action()
}

#[tauri::command]
pub fn vscode_complete_session_action(
    state: State<'_, crate::AppState>,
    action_id: String,
    success: bool,
    message: String,
) -> Result<(), String> {
    bridge(&state)?.complete_action(action_id, success, message)
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
    if method != "GET" && method != "POST" {
        write_response(&mut stream, 405, "Method Not Allowed", b"{}");
        return;
    }
    if !authorized {
        write_response(&mut stream, 401, "Unauthorized", b"{}");
        return;
    }
    if method == "POST" && path == "/v1/session-actions" {
        let raw_body = request.split("\r\n\r\n").nth(1).unwrap_or_default();
        match serde_json::from_str::<SessionActionRequest>(raw_body)
            .map_err(|_| "Invalid session action request.".to_string())
            .and_then(|input| queue_action(store, input))
        {
            Ok(action) => write_json_response(
                &mut stream,
                202,
                "Accepted",
                &serde_json::json!({ "actionId": action.id }),
            ),
            Err(message) => write_json_response(
                &mut stream,
                400,
                "Bad Request",
                &serde_json::json!({ "message": message }),
            ),
        }
        return;
    }
    if method == "GET" {
        if let Some(action_id) = parse_action_path(path) {
            let result = store
                .results
                .lock()
                .ok()
                .and_then(|results| results.get(action_id).cloned())
                .unwrap_or(SessionActionResult {
                    status: "pending".into(),
                    message: "PromptForge is processing the action.".into(),
                });
            write_json_response(&mut stream, 200, "OK", &result);
            return;
        }
        if let Some((project_id, session_id)) = parse_path(path) {
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
            return;
        }
        if let Some((project_id, session_id)) = parse_handoff_path(path) {
            let key = format!("{}:{}", project_id, session_id);
            let body = store
                .handoff_views
                .lock()
                .ok()
                .and_then(|views| views.get(&key).cloned());
            match body {
                Some(body) => write_response(&mut stream, 200, "OK", &body),
                None => write_response(&mut stream, 404, "Not Found", b"{}"),
            }
            return;
        }
    }
    write_response(&mut stream, 404, "Not Found", b"{}");
}

fn queue_action(store: &BridgeStore, input: SessionActionRequest) -> Result<SessionAction, String> {
    let bridge = ReadModelBridge {
        store: store.clone(),
    };
    bridge.queue_action(input)
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

fn parse_action_path(path: &str) -> Option<&str> {
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() != 4 || parts[1] != "v1" || parts[2] != "session-actions" {
        return None;
    }
    validate_id(parts[3], "action id").ok()?;
    Some(parts[3])
}

fn parse_handoff_path(path: &str) -> Option<(&str, &str)> {
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() != 5 || parts[1] != "v1" || parts[2] != "handoff-views" {
        return None;
    }
    validate_id(parts[3], "project id").ok()?;
    validate_id(parts[4], "session id").ok()?;
    Some((parts[3], parts[4]))
}

fn write_json_response<T: Serialize>(stream: &mut TcpStream, status: u16, reason: &str, body: &T) {
    match serde_json::to_vec(body) {
        Ok(bytes) => write_response(stream, status, reason, &bytes),
        Err(_) => write_response(stream, 500, "Internal Server Error", b"{}"),
    }
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
                handoff_views: Arc::new(Mutex::new(HashMap::new())),
                actions: Arc::new(Mutex::new(VecDeque::new())),
                results: Arc::new(Mutex::new(HashMap::new())),
                next_action_id: Arc::new(AtomicU64::new(1)),
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

    #[test]
    fn action_queue_accepts_only_supported_scoped_actions() {
        let bridge = test_bridge();
        let action = bridge
            .queue_action(SessionActionRequest {
                project_id: "project-1".into(),
                session_id: "session-1".into(),
                action: "checkpoint".into(),
                note: Some("Validated the current state.".into()),
                payload: None,
            })
            .expect("action queues");
        assert_eq!(action.id, "action-1");
        assert_eq!(
            bridge
                .take_action()
                .expect("take succeeds")
                .map(|item| item.action),
            Some("checkpoint".into())
        );
        assert!(bridge
            .queue_action(SessionActionRequest {
                project_id: "project-1".into(),
                session_id: "session-1".into(),
                action: "launch-shell".into(),
                note: None,
                payload: None,
            })
            .is_err());
    }

    #[test]
    fn action_completion_returns_explicit_success_or_failure() {
        let bridge = test_bridge();
        bridge
            .complete_action("action-1".into(), true, "Checkpoint note saved.".into())
            .expect("completion succeeds");
        let result = bridge
            .store
            .results
            .lock()
            .expect("result lock")
            .get("action-1")
            .cloned();
        assert_eq!(result.map(|item| item.status), Some("succeeded".into()));
    }

    #[test]
    fn bridge_startup_failure_is_degraded_without_panicking() {
        let (bridge, error) = optional_bridge_from(Err("Operation not permitted (os error 1)".into()));
        assert!(bridge.is_none());
        assert_eq!(error.as_deref(), Some("Operation not permitted (os error 1)"));
    }

    fn test_bridge() -> ReadModelBridge {
        ReadModelBridge {
            store: BridgeStore {
                token: "test-token".into(),
                port: 0,
                views: Arc::new(Mutex::new(HashMap::new())),
                handoff_views: Arc::new(Mutex::new(HashMap::new())),
                actions: Arc::new(Mutex::new(VecDeque::new())),
                results: Arc::new(Mutex::new(HashMap::new())),
                next_action_id: Arc::new(AtomicU64::new(1)),
            },
        }
    }
}
