use tauri::State;

use crate::keychain::SecretStore;
use crate::provider::{send_chat, ChatMessage, ChatOutcome, ProviderFailure};
use crate::AppState;

/// Command body, testable without the Tauri dispatcher. The API key is read
/// from the secret store HERE, in Rust — it is never sent to the webview and
/// never appears in errors (see provider.rs tests).
#[allow(clippy::too_many_arguments)]
pub async fn run_chat(
    secrets: &dyn SecretStore,
    base_url: &str,
    model_id: &str,
    keychain_account: &str,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
    timeout_ms: u64,
    json_mode: &str,
) -> Result<ChatOutcome, ProviderFailure> {
    if model_id.trim().is_empty() {
        return Err(ProviderFailure::config("Model ID is required — set it in Settings."));
    }
    let api_key = secrets
        .get(keychain_account)
        .map_err(|_| ProviderFailure::config("Keychain unavailable on this machine."))?;

    send_chat(
        base_url,
        model_id.trim(),
        api_key,
        messages,
        temperature,
        max_tokens,
        timeout_ms,
        json_mode == "on",
    )
    .await
}

/// Tauri matches the camelCase keys sent from TypeScript (`baseUrl`,
/// `maxTokens`, …) onto these snake_case parameter names automatically.
/// This mapping applies to top-level command parameters only — a nested
/// struct argument would need its own serde rename attributes.
///
/// `json_mode`: "on" sends response_format json_object; anything else does
/// not. "auto" is resolved by the client before calling.
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
) -> Result<ChatOutcome, ProviderFailure> {
    run_chat(
        state.secrets.as_ref(),
        &base_url,
        &model_id,
        &keychain_account,
        messages,
        temperature,
        max_tokens,
        timeout_ms,
        &json_mode,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keychain::InMemoryStore;

    fn message() -> Vec<ChatMessage> {
        vec![ChatMessage { role: "user".into(), content: "ping".into() }]
    }

    #[tokio::test]
    async fn empty_model_id_is_a_config_error_before_keychain_and_network() {
        let store = InMemoryStore::default();
        store.set("provider/default", "k").unwrap();
        let err = run_chat(
            &store,
            "http://127.0.0.1:1",
            "   ",
            "provider/default",
            message(),
            0.2,
            50,
            1000,
            "off",
        )
        .await
        .unwrap_err();
        assert_eq!(err.class, "config");
    }

    #[tokio::test]
    async fn missing_stored_key_is_a_config_error_before_network_io() {
        let store = InMemoryStore::default();
        let err = run_chat(
            &store,
            "http://127.0.0.1:1",
            "any-model",
            "provider/default",
            message(),
            0.2,
            50,
            1000,
            "off",
        )
        .await
        .unwrap_err();
        assert_eq!(err.class, "config");
        assert_eq!(err.message, "No API key stored — add one in Settings.");
    }
}
