use tauri::State;

use crate::keychain::SecretStore;
use crate::AppState;

/// Error strings returned to the webview never contain the secret: they are
/// fixed-shape messages built from the failure variant only.

pub fn set_secret(secrets: &dyn SecretStore, account: &str, secret: &str) -> Result<(), String> {
    if account.is_empty() || secret.is_empty() {
        return Err("Keychain error: account and secret are required.".to_string());
    }
    secrets.set(account, secret).map_err(|e| format!("Keychain error: {e}"))
}

pub fn delete_secret(secrets: &dyn SecretStore, account: &str) -> Result<bool, String> {
    secrets.delete(account).map_err(|e| format!("Keychain error: {e}"))
}

/// Presence check only — the webview never receives the secret itself.
/// (A `keychain_get` command is deliberately NOT registered: reading keys is
/// reserved for the Rust transport, see commands/provider.rs.)
pub fn has_secret(secrets: &dyn SecretStore, account: &str) -> Result<bool, String> {
    Ok(secrets.get(account).map_err(|e| format!("Keychain error: {e}"))?.is_some())
}

#[tauri::command]
pub fn keychain_set(state: State<'_, AppState>, account: String, secret: String) -> Result<(), String> {
    set_secret(state.secrets.as_ref(), &account, &secret)
}

#[tauri::command]
pub fn keychain_delete(state: State<'_, AppState>, account: String) -> Result<bool, String> {
    delete_secret(state.secrets.as_ref(), &account)
}

#[tauri::command]
pub fn keychain_has(state: State<'_, AppState>, account: String) -> Result<bool, String> {
    has_secret(state.secrets.as_ref(), &account)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keychain::InMemoryStore;

    #[test]
    fn set_requires_non_empty_values() {
        let store = InMemoryStore::default();
        assert!(set_secret(&store, "", "x").is_err());
        assert!(set_secret(&store, "a", "").is_err());
        assert!(set_secret(&store, "provider/default", "secret").is_ok());
    }

    #[test]
    fn error_messages_do_not_contain_the_secret() {
        let store = InMemoryStore::default();
        let err = set_secret(&store, "", "top-secret-value").unwrap_err();
        assert!(!err.contains("top-secret-value"));
    }

    #[test]
    fn has_reflects_presence_without_returning_the_secret() {
        let store = InMemoryStore::default();
        assert!(!has_secret(&store, "provider/default").unwrap());
        set_secret(&store, "provider/default", "secret").unwrap();
        assert!(has_secret(&store, "provider/default").unwrap());
        assert!(delete_secret(&store, "provider/default").unwrap());
        assert!(!has_secret(&store, "provider/default").unwrap());
    }
}
