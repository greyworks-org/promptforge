use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

/// User-facing failure. `message` must never contain the API key, request
/// headers, or unbounded provider payloads (see tests at the bottom).
#[derive(Debug, Serialize)]
pub struct ProviderFailure {
    pub class: String,
    pub message: String,
}

impl ProviderFailure {
    pub fn config(message: impl Into<String>) -> Self {
        Self {
            class: "config".into(),
            message: message.into(),
        }
    }
    pub fn auth(message: impl Into<String>) -> Self {
        Self {
            class: "auth".into(),
            message: message.into(),
        }
    }
    pub fn network(message: impl Into<String>) -> Self {
        Self {
            class: "network".into(),
            message: message.into(),
        }
    }
    pub fn http_api(message: impl Into<String>) -> Self {
        Self {
            class: "http_api".into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Raw transport outcome. Field names are camelCase on the wire to match the
/// TypeScript `ChatOutcome` type.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutcome {
    pub status: u16,
    pub body: String,
    pub latency_ms: u64,
}

/// Base URL policy: https for anything remote; http only for localhost so
/// the mock provider can run in development. No model name or endpoint path
/// is implied anywhere — both are user-configured.
pub fn validate_base_url(raw: &str) -> Result<String, ProviderFailure> {
    let parsed = url::Url::parse(raw.trim())
        .map_err(|_| ProviderFailure::config("Base URL is not a valid URL."))?;
    let host_ok = matches!(parsed.scheme(), "https")
        || (parsed.scheme() == "http"
            && matches!(parsed.host_str(), Some("localhost") | Some("127.0.0.1")));
    if !host_ok {
        return Err(ProviderFailure::config(
            "Base URL must use https (http is allowed only for localhost).",
        ));
    }
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

pub fn completions_url(base: &str) -> String {
    format!("{}/chat/completions", base.trim_end_matches('/'))
}

fn is_openai_endpoint(base: &str) -> bool {
    url::Url::parse(base)
        .ok()
        .and_then(|url| {
            url.host_str()
                .map(|host| host.eq_ignore_ascii_case("api.openai.com"))
        })
        .unwrap_or(false)
}

/// OpenAI-compatible chat completions body. `response_format` is included
/// only when JSON mode is explicitly on (see docs/DEEPSEEK_INTEGRATION.md).
#[cfg(test)]
pub fn build_body(
    model: &str,
    messages: &[ChatMessage],
    temperature: f32,
    max_tokens: u32,
    json_mode_on: bool,
) -> serde_json::Value {
    build_body_for_endpoint(
        model,
        messages,
        temperature,
        max_tokens,
        json_mode_on,
        false,
        None,
    )
}

fn build_body_for_endpoint(
    model: &str,
    messages: &[ChatMessage],
    temperature: f32,
    max_tokens: u32,
    json_mode_on: bool,
    openai_endpoint: bool,
    reasoning_effort: Option<&str>,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
    });
    if openai_endpoint {
        let effort = reasoning_effort.filter(|value| *value != "none");
        // OpenAI counts hidden reasoning tokens inside max_completion_tokens.
        // Preserve the configured visible-output budget while reserving an
        // equal bounded allowance for reasoning; legacy endpoints keep their
        // original max_tokens value unchanged.
        let completion_budget = if effort.is_some() {
            max_tokens.saturating_mul(2)
        } else {
            max_tokens
        };
        body["max_completion_tokens"] = serde_json::json!(completion_budget);
        if let Some(effort) = effort {
            body["reasoning_effort"] = serde_json::json!(effort);
        }
    } else {
        body["temperature"] = serde_json::json!(temperature);
        body["max_tokens"] = serde_json::json!(max_tokens);
    }
    if json_mode_on {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }
    body
}

/// Maps a non-success HTTP status to an error class (taxonomy in
/// docs/DEEPSEEK_INTEGRATION.md §6). Returns None for success statuses.
pub fn classify_status(status: u16) -> Option<&'static str> {
    match status {
        200..=299 => None,
        401 | 403 => Some("auth"),
        408 | 429 => Some("http_api"),
        400..=499 => Some("http_api"),
        _ => Some("http_api"),
    }
}

/// Extracts a short, scrubbed provider error message from an error body.
/// Falls back to a generic message; never returns the raw body verbatim.
fn scrub_provider_message(status: u16, body: &str) -> String {
    let parsed = serde_json::from_str::<serde_json::Value>(body).ok();
    let error = parsed
        .as_ref()
        .and_then(|v| v.get("error"))
        .and_then(|e| e.as_object());
    let safe_field = |key: &str| -> Option<String> {
        error
            .and_then(|fields| fields.get(key))
            .and_then(|value| value.as_str())
            .map(|value| {
                let trimmed: String = value.chars().take(200).collect();
                if trimmed.contains("sk-") || trimmed.to_ascii_lowercase().contains("bearer ") {
                    "[redacted]".to_string()
                } else {
                    trimmed
                }
            })
    };
    let kind = safe_field("code").or_else(|| safe_field("type"));
    let message = safe_field("message");
    match (kind, message) {
        (Some(kind), Some(message)) => format!("HTTP {status} — {kind}: {message}"),
        (Some(kind), None) => format!("HTTP {status} — {kind}"),
        (None, Some(message)) => format!("HTTP {status} — Provider error: {message}"),
        (None, None) => format!("HTTP {status} — Endpoint returned an unexpected error."),
    }
}

fn network_error(err: &reqwest::Error) -> ProviderFailure {
    if err.is_timeout() {
        ProviderFailure::network("Connection timed out.")
    } else {
        ProviderFailure::network("Connection failed — check the base URL and your network.")
    }
}

/// Performs one chat completion call. The API key is passed in by the command
/// layer (which read it from the keychain) and is never referenced in any
/// error message or log.
#[allow(clippy::too_many_arguments)]
#[cfg(test)]
pub async fn send_chat(
    base_url: &str,
    model: &str,
    api_key: Option<String>,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
    timeout_ms: u64,
    json_mode_on: bool,
) -> Result<ChatOutcome, ProviderFailure> {
    send_chat_with_options(
        base_url,
        model,
        api_key,
        messages,
        temperature,
        max_tokens,
        timeout_ms,
        json_mode_on,
        None,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn send_chat_with_options(
    base_url: &str,
    model: &str,
    api_key: Option<String>,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
    timeout_ms: u64,
    json_mode_on: bool,
    reasoning_effort: Option<&str>,
) -> Result<ChatOutcome, ProviderFailure> {
    let api_key = api_key
        .filter(|k| !k.is_empty())
        .ok_or_else(|| ProviderFailure::config("No API key stored — add one in Settings."))?;

    let base = validate_base_url(base_url)?;
    let url = completions_url(&base);
    let body = build_body_for_endpoint(
        model,
        &messages,
        temperature,
        max_tokens,
        json_mode_on,
        is_openai_endpoint(&base),
        reasoning_effort,
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms.max(1)))
        .build()
        .map_err(|_| ProviderFailure::config("HTTP client could not be initialized."))?;

    let started = Instant::now();
    let response = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| network_error(&e))?;

    let status = response.status().as_u16();
    let text = response.text().await.map_err(|e| network_error(&e))?;
    let latency_ms = started.elapsed().as_millis() as u64;

    match classify_status(status) {
        None => Ok(ChatOutcome {
            status,
            body: text,
            latency_ms,
        }),
        Some("auth") => Err(ProviderFailure::auth(scrub_provider_message(status, &text))),
        Some(_) => Err(ProviderFailure::http_api(scrub_provider_message(
            status, &text,
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn message() -> Vec<ChatMessage> {
        vec![ChatMessage {
            role: "user".into(),
            content: "ping".into(),
        }]
    }

    /// Minimal single-shot HTTP server for transport tests.
    fn serve_once(response: String, hold_ms: u64) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 4096];
                let _ = stream.read(&mut buf);
                if hold_ms > 0 {
                    thread::sleep(Duration::from_millis(hold_ms));
                }
                let _ = stream.write_all(response.as_bytes());
            }
        });
        format!("http://127.0.0.1:{}", addr.port())
    }

    fn http_response(status_line: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status_line}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    #[test]
    fn base_url_policy() {
        assert!(validate_base_url("https://api.example.com/v1").is_ok());
        assert_eq!(
            validate_base_url("https://api.example.com/v1/").unwrap(),
            "https://api.example.com/v1"
        );
        assert!(validate_base_url("http://localhost:4141").is_ok());
        assert!(validate_base_url("http://127.0.0.1:4141").is_ok());
        assert!(validate_base_url("http://api.example.com").is_err());
        assert!(validate_base_url("not a url").is_err());
        assert!(validate_base_url("ftp://localhost:21").is_err());
    }

    #[test]
    fn completions_url_appends_once() {
        assert_eq!(
            completions_url("https://api.example.com/v1"),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            completions_url("https://api.example.com/v1/"),
            "https://api.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn body_shape_and_json_mode() {
        let body = build_body("some-model", &message(), 0.2, 50, false);
        assert_eq!(body["model"], "some-model");
        assert_eq!(body["max_tokens"], 50);
        assert!(body.get("response_format").is_none());

        let with_json = build_body("some-model", &message(), 0.2, 50, true);
        assert_eq!(with_json["response_format"]["type"], "json_object");
    }

    #[test]
    fn status_classification() {
        assert_eq!(classify_status(200), None);
        assert_eq!(classify_status(401), Some("auth"));
        assert_eq!(classify_status(403), Some("auth"));
        assert_eq!(classify_status(429), Some("http_api"));
        assert_eq!(classify_status(500), Some("http_api"));
    }

    #[test]
    fn scrubbed_message_keeps_provider_text_short() {
        let body = r#"{"error": {"message": "rate limited"}}"#;
        assert_eq!(
            scrub_provider_message(429, body),
            "HTTP 429 — Provider error: rate limited"
        );
        // Non-JSON bodies never leak verbatim.
        assert_eq!(
            scrub_provider_message(500, "<html>weird</html>"),
            "HTTP 500 — Endpoint returned an unexpected error."
        );
        assert_eq!(
            scrub_provider_message(
                400,
                r#"{"error":{"code":"bad_request","message":"sk-super-secret"}}"#
            ),
            "HTTP 400 — bad_request: [redacted]"
        );
    }

    #[test]
    fn openai_reasoning_body_uses_modern_completion_fields() {
        let body = build_body_for_endpoint(
            "gpt-5.6-luna",
            &message(),
            0.2,
            200,
            false,
            true,
            Some("high"),
        );
        assert_eq!(body["max_completion_tokens"], 400);
        assert_eq!(body["reasoning_effort"], "high");
        assert!(body.get("max_tokens").is_none());
        assert!(body.get("temperature").is_none());
    }

    #[tokio::test]
    async fn successful_call_returns_body_and_latency() {
        let base = serve_once(
            http_response(
                "200 OK",
                r#"{"choices":[{"message":{"content":"{\"ok\":true}"}}],"usage":{"prompt_tokens":1}}"#,
            ),
            0,
        );
        let outcome = send_chat(
            &base,
            "any-model",
            Some("test-key".into()),
            message(),
            0.2,
            50,
            5000,
            false,
        )
        .await
        .unwrap();
        assert_eq!(outcome.status, 200);
        assert!(outcome.body.contains("choices"));
        assert!(outcome.latency_ms < 5000);
    }

    #[tokio::test]
    async fn auth_rejection_maps_to_auth_class_without_leaking_key() {
        let secret = "super-secret-key-abc123";
        let base = serve_once(
            http_response("401 Unauthorized", r#"{"error":{"message":"invalid key"}}"#),
            0,
        );
        let err = send_chat(
            &base,
            "any-model",
            Some(secret.into()),
            message(),
            0.2,
            50,
            5000,
            false,
        )
        .await
        .unwrap_err();
        assert_eq!(err.class, "auth");
        assert!(!err.message.contains(secret));
    }

    #[tokio::test]
    async fn timeout_maps_to_network_class() {
        // Server accepts the connection but never answers in time.
        let base = serve_once(http_response("200 OK", "{}"), 1500);
        let err = send_chat(
            &base,
            "any-model",
            Some("k".into()),
            message(),
            0.2,
            50,
            150,
            false,
        )
        .await
        .unwrap_err();
        assert_eq!(err.class, "network");
        assert_eq!(err.message, "Connection timed out.");
    }

    #[tokio::test]
    async fn unreachable_endpoint_maps_to_network_class() {
        // Port 1 on localhost is closed; connection must fail fast.
        let err = send_chat(
            "http://127.0.0.1:1",
            "any-model",
            Some("k".into()),
            message(),
            0.2,
            50,
            2000,
            false,
        )
        .await
        .unwrap_err();
        assert_eq!(err.class, "network");
    }

    #[tokio::test]
    async fn missing_key_is_a_config_error_before_any_network_io() {
        let err = send_chat(
            "http://127.0.0.1:1",
            "any-model",
            None,
            message(),
            0.2,
            50,
            2000,
            false,
        )
        .await
        .unwrap_err();
        assert_eq!(err.class, "config");
    }
}
