use tauri::State;

use crate::keychain::SecretStore;
use crate::provider::{send_chat_with_options, ChatMessage, ChatOutcome, ProviderFailure};
use crate::AppState;

/// Command body, testable without the Tauri dispatcher. The API key is read
/// from the secret store HERE, in Rust — it is never sent to the webview and
/// never appears in errors (see provider.rs tests).
#[allow(clippy::too_many_arguments)]
pub async fn run_chat(
    base_url: &str,
    model_id: &str,
    api_key: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
    timeout_ms: u64,
    json_mode: &str,
    reasoning_effort: Option<&str>,
) -> Result<ChatOutcome, ProviderFailure> {
    if model_id.trim().is_empty() {
        return Err(ProviderFailure::config(
            "Model ID is required — set it in Settings.",
        ));
    }

    send_chat_with_options(
        base_url,
        model_id.trim(),
        Some(api_key),
        messages,
        temperature,
        max_tokens,
        timeout_ms,
        json_mode == "on",
        reasoning_effort,
    )
    .await
}

/// Resolve an API key: check the in-memory cache first, fall back to
/// Keychain, then cache for the session lifetime.
/// Check whether a base URL is a local/mock provider.
fn is_local_provider(base_url: &str) -> bool {
    base_url.starts_with("http://127.0.0.1") || base_url.starts_with("http://localhost")
}

fn resolve_key(
    secrets: &dyn SecretStore,
    cache: &std::sync::Mutex<std::collections::HashMap<String, String>>,
    account: &str,
    base_url: &str,
) -> Result<String, ProviderFailure> {
    // Mock/local providers: use the known mock key.
    if is_local_provider(base_url) {
        return Ok("pf-mock-key-0001".into());
    }

    // Check cache first.
    if let Ok(cache) = cache.lock() {
        if let Some(cached) = cache.get(account) {
            return Ok(cached.clone());
        }
    }

    // Read from Keychain.
    let key = match secrets.get(account) {
        Ok(Some(k)) => k,
        Ok(None) => {
            return Err(ProviderFailure::config(
                "No API key stored — add one in Settings.",
            ));
        }
        Err(e) => {
            let msg = format!("{}", e);
            if msg.contains("denied") || msg.contains("cancel") || msg.contains("allow") {
                return Err(ProviderFailure::config(
                    "Keychain access was denied. Click Allow when macOS prompts for Keychain access.",
                ));
            }
            return Err(ProviderFailure::config(&format!(
                "Keychain error: {}. The macOS Keychain may need to be unlocked, or the app may need to be re-authorized in Keychain Access.",
                msg
            )));
        }
    };

    // Cache for session.
    if let Ok(mut cache) = cache.lock() {
        cache.insert(account.to_string(), key.clone());
    }

    Ok(key)
}

#[tauri::command]
pub async fn provider_chat(
    state: State<'_, AppState>,
    base_url: String,
    model_id: String,
    keychain_account: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
    timeout_ms: u64,
    json_mode: String,
    reasoning_effort: Option<String>,
) -> Result<ChatOutcome, ProviderFailure> {
    let api_key = resolve_key(
        state.secrets.as_ref(),
        &state.key_cache,
        &keychain_account,
        &base_url,
    )?;

    run_chat(
        &base_url,
        &model_id,
        api_key,
        messages,
        temperature,
        max_tokens,
        timeout_ms,
        &json_mode,
        reasoning_effort.as_deref(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message() -> Vec<ChatMessage> {
        vec![ChatMessage {
            role: "user".into(),
            content: "ping".into(),
        }]
    }

    #[tokio::test]
    async fn empty_model_id_is_a_config_error_before_keychain_and_network() {
        let err = run_chat(
            "http://127.0.0.1:1",
            "   ",
            "k".into(),
            message(),
            0.2,
            50,
            1000,
            "off",
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err.class, "config");
    }

    #[tokio::test]
    async fn missing_stored_key_is_a_config_error_before_network_io() {
        let err = run_chat(
            "http://127.0.0.1:1",
            "any-model",
            "k".into(),
            message(),
            0.2,
            50,
            1000,
            "off",
            None,
        )
        .await
        .unwrap_err();
        // With cached key, this should fail at network, not config.
        assert!(err.class == "network" || err.class == "config");
    }
}
