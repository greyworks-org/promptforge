mod commands;
mod keychain;
mod provider;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use keychain::{KeyringStore, SecretStore};

pub struct AppState {
    pub secrets: Arc<dyn SecretStore>,
    /// In-memory key cache: keychain_account → api_key.
    /// Populated on first read, cleared on app exit.
    /// Never persisted — Keychain remains the source of truth.
    pub key_cache: Mutex<HashMap<String, String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            secrets: Arc::new(KeyringStore),
            key_cache: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::keychain::keychain_set,
            commands::keychain::keychain_delete,
            commands::keychain::keychain_has,
            commands::provider::provider_chat,
            commands::fs::fs_metadata,
            commands::fs::fs_read_text,
            commands::fs::fs_write_text,
            commands::fs::fs_list_dir,
            commands::fs::fs_exists,
            commands::fs::fs_resolve_project_root,
            commands::fs::fs_read_anchor,
            commands::git::git_inspect,
            commands::shell::open_terminal,
            commands::shell::launch_cli,
            commands::shell::runtime_status,
            commands::shell::launch_runtime,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PromptForge");
}
