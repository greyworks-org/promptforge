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

/// Presence check — checks the in-memory cache first, falls back to
/// Keychain. The webview never receives the secret itself.
pub fn has_secret(
    secrets: &dyn SecretStore,
    cache: &std::sync::Mutex<std::collections::HashMap<String, String>>,
    account: &str,
) -> Result<bool, String> {
    // Check cache first — avoids repeated Keychain authorization prompts.
    if let Ok(cache) = cache.lock() {
        if cache.contains_key(account) {
            return Ok(true);
        }
    }
    // Read from Keychain and cache the result for the session.
    match secrets.get(account) {
        Ok(Some(key)) => {
            if let Ok(mut cache) = cache.lock() {
                cache.insert(account.to_string(), key);
            }
            Ok(true)
        }
        Ok(None) => Ok(false),
        Err(e) => Err(format!("Keychain error: {e}")),
    }
}

#[tauri::command]
pub fn keychain_set(state: State<'_, AppState>, account: String, secret: String) -> Result<(), String> {
    // Update the in-memory cache.
    if let Ok(mut cache) = state.key_cache.lock() {
        cache.insert(account.clone(), secret.clone());
    }
    set_secret(state.secrets.as_ref(), &account, &secret)
}

#[tauri::command]
pub fn keychain_delete(state: State<'_, AppState>, account: String) -> Result<bool, String> {
    // Clear the cache entry.
    if let Ok(mut cache) = state.key_cache.lock() {
        cache.remove(&account);
    }
    delete_secret(state.secrets.as_ref(), &account)
}

#[tauri::command]
pub fn keychain_has(state: State<'_, AppState>, account: String) -> Result<bool, String> {
    has_secret(state.secrets.as_ref(), &state.key_cache, &account)
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
        use std::collections::HashMap;
        let store = InMemoryStore::default();
        let cache = std::sync::Mutex::new(HashMap::new());
        assert!(!has_secret(&store, &cache, "provider/default").unwrap());
        set_secret(&store, "provider/default", "secret").unwrap();
        // After set via standalone function, cache doesn't have it yet,
        // but the store does — has_secret falls back to Keychain and caches.
        assert!(has_secret(&store, &cache, "provider/default").unwrap());
        // Delete from store AND clear cache.
        delete_secret(&store, "provider/default").unwrap();
        cache.lock().unwrap().remove("provider/default");
        assert!(!has_secret(&store, &cache, "provider/default").unwrap());
    }
}
