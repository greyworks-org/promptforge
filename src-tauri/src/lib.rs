mod commands;
mod keychain;
mod provider;

use std::sync::Arc;

use keychain::{KeyringStore, SecretStore};

pub struct AppState {
    pub secrets: Arc<dyn SecretStore>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState { secrets: Arc::new(KeyringStore) })
        .invoke_handler(tauri::generate_handler![
            commands::keychain::keychain_set,
            commands::keychain::keychain_delete,
            commands::keychain::keychain_has,
            commands::provider::provider_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PromptForge");
}
