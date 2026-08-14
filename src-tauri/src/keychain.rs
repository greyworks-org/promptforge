#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Mutex;

/// Keychain service namespace for all PromptForge secrets.
pub const SERVICE: &str = "promptforge";

#[derive(Debug, thiserror::Error)]
pub enum KeychainError {
    #[error("keychain backend unavailable")]
    Backend,
    #[error("keychain operation failed")]
    Operation,
}

/// Secret storage boundary. The webview never receives secrets through this
/// interface: only `provider_chat` reads keys, and only to attach the
/// Authorization header inside Rust.
pub trait SecretStore: Send + Sync {
    fn set(&self, account: &str, secret: &str) -> Result<(), KeychainError>;
    fn get(&self, account: &str) -> Result<Option<String>, KeychainError>;
    fn delete(&self, account: &str) -> Result<bool, KeychainError>;
}

/// macOS Keychain via the `keyring` crate (Security framework).
pub struct KeyringStore;

impl SecretStore for KeyringStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), KeychainError> {
        let entry = keyring::Entry::new(SERVICE, account).map_err(|_| KeychainError::Backend)?;
        entry
            .set_password(secret)
            .map_err(|_| KeychainError::Operation)
    }

    fn get(&self, account: &str) -> Result<Option<String>, KeychainError> {
        let entry = keyring::Entry::new(SERVICE, account).map_err(|_| KeychainError::Backend)?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(KeychainError::Operation),
        }
    }

    fn delete(&self, account: &str) -> Result<bool, KeychainError> {
        let entry = keyring::Entry::new(SERVICE, account).map_err(|_| KeychainError::Backend)?;
        match entry.delete_credential() {
            Ok(()) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(_) => Err(KeychainError::Operation),
        }
    }
}

/// In-memory store for tests.
#[cfg(test)]
#[derive(Default)]
pub struct InMemoryStore {
    map: Mutex<HashMap<String, String>>,
}

#[cfg(test)]
impl SecretStore for InMemoryStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), KeychainError> {
        self.map
            .lock()
            .map_err(|_| KeychainError::Operation)?
            .insert(account.to_string(), secret.to_string());
        Ok(())
    }

    fn get(&self, account: &str) -> Result<Option<String>, KeychainError> {
        Ok(self
            .map
            .lock()
            .map_err(|_| KeychainError::Operation)?
            .get(account)
            .cloned())
    }

    fn delete(&self, account: &str) -> Result<bool, KeychainError> {
        Ok(self
            .map
            .lock()
            .map_err(|_| KeychainError::Operation)?
            .remove(account)
            .is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_get_delete_roundtrip() {
        let store = InMemoryStore::default();
        assert_eq!(store.get("provider/default").unwrap(), None);

        store.set("provider/default", "sk-test-123").unwrap();
        assert_eq!(
            store.get("provider/default").unwrap(),
            Some("sk-test-123".to_string())
        );

        // Replace overwrites.
        store.set("provider/default", "sk-test-456").unwrap();
        assert_eq!(
            store.get("provider/default").unwrap(),
            Some("sk-test-456".to_string())
        );

        assert!(store.delete("provider/default").unwrap());
        assert_eq!(store.get("provider/default").unwrap(), None);

        // Deleting a missing key is not an error.
        assert!(!store.delete("provider/default").unwrap());
    }

    #[test]
    fn accounts_are_isolated() {
        let store = InMemoryStore::default();
        store.set("provider/a", "key-a").unwrap();
        store.set("provider/b", "key-b").unwrap();
        assert_eq!(store.get("provider/a").unwrap(), Some("key-a".to_string()));
        assert_eq!(store.get("provider/b").unwrap(), Some("key-b".to_string()));
    }
}
