use std::env;
use std::ffi::OsStr;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub runtime: String,
    pub binary: String,
    pub installed: bool,
    pub can_launch: bool,
    pub supports_resume: bool,
    pub supports_model_routing: bool,
    pub version: Option<String>,
    pub capabilities: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLaunchResult {
    pub started: bool,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub stderr: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualReviewResult {
    pub output: String,
    pub target: String,
    pub screenshot_captured: bool,
}

fn runtime_binary(runtime: &str) -> Option<&'static str> {
    match runtime {
        "claude-code" => Some("claude"),
        "qwen-code" => Some("qwen"),
        "codex" => Some("codex"),
        "opencode" => Some("opencode"),
        _ => None,
    }
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else { return false };
    if !metadata.is_file() { return false; }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return metadata.permissions().mode() & 0o111 != 0;
    }
    #[cfg(not(unix))]
    { true }
}

fn user_local_runtime_path(runtime: &str, home: Option<&Path>) -> Option<PathBuf> {
    if runtime != "opencode" { return None; }
    Some(home?.join(".opencode").join("bin").join("opencode"))
}

fn standard_runtime_paths(runtime: &str) -> &'static [&'static str] {
    if runtime == "opencode" {
        &[
            "/opt/homebrew/bin/opencode",
            "/usr/local/bin/opencode",
            "/usr/bin/opencode",
        ]
    } else {
        &[]
    }
}

/// Resolve only explicit PATH entries, then documented user-local and standard macOS locations.
/// No directory scanning or recursive HOME search is performed.
fn resolve_runtime_executable(
    runtime: &str,
    path_env: Option<&OsStr>,
    home: Option<&Path>,
) -> Option<PathBuf> {
    let binary = runtime_binary(runtime)?;
    if let Some(path_env) = path_env {
        for directory in env::split_paths(path_env).filter(|path| !path.as_os_str().is_empty()) {
            let candidate = directory.join(binary);
            if is_executable_file(&candidate) { return Some(candidate); }
        }
    }
    if let Some(candidate) = user_local_runtime_path(runtime, home) {
        if is_executable_file(&candidate) { return Some(candidate); }
    }
    for candidate in standard_runtime_paths(runtime).iter().map(PathBuf::from) {
        if is_executable_file(&candidate) { return Some(candidate); }
    }
    Some(PathBuf::from(binary))
}

fn runtime_capabilities(runtime: &str) -> (bool, bool, Vec<String>) {
    if runtime == "opencode" {
        return (
            true,
            true,
            vec![
                "tui".into(),
                "session-resume".into(),
                "model-routing".into(),
                "structured-run-events".into(),
            ],
        );
    }
    (false, false, vec!["terminal-launch".into()])
}

/// Detect a known runtime without exposing PATH or executing shell syntax.
#[tauri::command]
pub fn runtime_status(runtime: String) -> Result<RuntimeStatus, String> {
    let path_env = env::var_os("PATH");
    let home = env::var_os("HOME");
    runtime_status_with_environment(runtime, path_env.as_deref(), home.as_deref().map(Path::new))
}

fn runtime_status_with_environment(
    runtime: String,
    path_env: Option<&OsStr>,
    home: Option<&Path>,
) -> Result<RuntimeStatus, String> {
    let binary = runtime_binary(&runtime)
        .ok_or_else(|| format!("Unknown runtime: {}", runtime))?;
    let (supports_resume, supports_model_routing, capabilities) = runtime_capabilities(&runtime);
    let executable = resolve_runtime_executable(&runtime, path_env, home)
        .ok_or_else(|| format!("Unknown runtime: {}", runtime))?;
    let mut version_command = Command::new(&executable);
    version_command.arg("--version");
    match path_env {
        Some(path) => { version_command.env("PATH", path); }
        None => { version_command.env_remove("PATH"); }
    }
    match version_command.output() {
        Ok(output) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout);
            let version = text.lines().next().map(str::trim).filter(|line| !line.is_empty()).map(String::from);
            Ok(RuntimeStatus {
                runtime,
                binary: binary.into(),
                installed: true,
                can_launch: true,
                supports_resume,
                supports_model_routing,
                version,
                capabilities,
                error: None,
            })
        }
        Ok(output) => Ok(RuntimeStatus {
            runtime,
            binary: binary.into(),
            installed: false,
            can_launch: false,
            supports_resume,
            supports_model_routing,
            version: None,
            capabilities,
            error: Some(format!("{} exited with status {}", binary, output.status)),
        }),
        Err(error) => Ok(RuntimeStatus {
            runtime,
            binary: binary.into(),
            installed: false,
            can_launch: false,
            supports_resume,
            supports_model_routing,
            version: None,
            capabilities,
            error: Some(format!("{} is unavailable: {}", binary, error)),
        }),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeModel {
    pub runtime: String,
    pub provider_id: String,
    pub model_id: String,
    pub model_ref: String,
    pub display_name: String,
    pub available: bool,
    pub configured: bool,
    pub availability: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeModelDiscovery {
    pub runtime: String,
    pub models: Vec<OpenCodeModel>,
    pub source: String,
    pub warning: Option<String>,
}

fn strip_ansi(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut in_escape = false;
    for ch in value.chars() {
        if in_escape {
            if ch.is_ascii_alphabetic() {
                in_escape = false;
            }
            continue;
        }
        if ch == '\u{1b}' {
            in_escape = true;
        } else {
            output.push(ch);
        }
    }
    output
}

fn parse_model_refs(output: &str) -> Vec<String> {
    let mut refs = Vec::new();
    for line in strip_ansi(output).lines() {
        let Some(candidate) = line.split_whitespace().next() else { continue };
        if !candidate.contains('/') || !valid_runtime_value(candidate, 256) { continue }
        if refs.iter().any(|model_ref| model_ref == candidate) { continue }
        refs.push(candidate.to_string());
    }
    refs
}

fn model_from_ref(model_ref: &str, available: bool, configured: bool, availability: &str) -> Option<OpenCodeModel> {
    let (provider_id, model_id) = model_ref.split_once('/')?;
    if provider_id.is_empty() || model_id.is_empty() || !valid_runtime_value(model_ref, 256) {
        return None;
    }
    Some(OpenCodeModel {
        runtime: "opencode".into(),
        provider_id: provider_id.to_string(),
        model_id: model_id.to_string(),
        model_ref: model_ref.to_string(),
        display_name: model_ref.to_string(),
        available,
        configured,
        availability: availability.to_string(),
    })
}

fn extract_model_ref(config: &str) -> Option<String> {
    for line in config.lines() {
        let trimmed = line.trim();
        let Some(key_start) = trimmed.find("\"model\"") else { continue };
        let rest = &trimmed[key_start + "\"model\"".len()..];
        let rest = rest.trim_start();
        let rest = rest.strip_prefix(':')?.trim_start();
        let quoted = rest.strip_prefix('"')?;
        let end = quoted.find('"')?;
        let model_ref = &quoted[..end];
        if model_ref.contains('/') && valid_runtime_value(model_ref, 256) {
            return Some(model_ref.to_string());
        }
    }
    None
}

fn configured_model_ref(project_root: &Path) -> Option<String> {
    let mut paths = vec![
        project_root.join("opencode.json"),
        project_root.join("opencode.jsonc"),
    ];
    if let Ok(config_path) = env::var("OPENCODE_CONFIG") {
        let path = PathBuf::from(config_path);
        paths.push(if path.is_absolute() { path } else { project_root.join(path) });
    }
    let config_home = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")));
    if let Some(config_home) = config_home {
        let opencode = config_home.join("opencode");
        paths.extend([
            opencode.join("opencode.json"),
            opencode.join("opencode.jsonc"),
            opencode.join("settings.json"),
        ]);
    }
    for path in paths {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Some(model_ref) = extract_model_ref(&content) {
                return Some(model_ref);
            }
        }
    }
    None
}

/// Reads OpenCode's model catalog without importing or duplicating provider credentials.
/// The CLI may fail when its external state is unavailable, so the configured model is a
/// deliberate, clearly marked fallback rather than an inferred provider registry.
#[tauri::command]
pub fn opencode_models(project_root: String) -> Result<OpenCodeModelDiscovery, String> {
    let root = PathBuf::from(&project_root);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", project_root));
    }

    let configured = configured_model_ref(&root);
    let path_env = env::var_os("PATH");
    let home = env::var_os("HOME");
    let executable = resolve_runtime_executable("opencode", path_env.as_deref(), home.as_deref().map(Path::new))
        .ok_or_else(|| "Unknown runtime: opencode".to_string())?;
    let command = Command::new(executable)
        .arg("models")
        .current_dir(&root)
        .output();
    let (refs, command_succeeded) = match command {
        Ok(output) => (parse_model_refs(&String::from_utf8_lossy(&output.stdout)), output.status.success()),
        Err(_) => (Vec::new(), false),
    };

    let mut models: Vec<OpenCodeModel> = refs.iter()
        .filter_map(|model_ref| model_from_ref(
            model_ref,
            true,
            configured.as_deref() == Some(model_ref.as_str()),
            "available",
        ))
        .collect();
    if let Some(configured_ref) = configured.as_deref() {
        if !models.iter().any(|model| model.model_ref == configured_ref) {
            if let Some(model) = model_from_ref(configured_ref, false, true, "configured") {
                models.push(model);
            }
        }
    }

    let source = if command_succeeded && !refs.is_empty() {
        "opencode-cli"
    } else if configured.is_some() {
        "configured-fallback"
    } else {
        "unavailable"
    };
    let warning = if source == "opencode-cli" {
        None
    } else if configured.is_some() {
        Some("OpenCode model enumeration was unavailable; showing the configured model only.".into())
    } else {
        Some("OpenCode model enumeration was unavailable and no configured model was found.".into())
    };

    Ok(OpenCodeModelDiscovery {
        runtime: "opencode".into(),
        models,
        source: source.into(),
        warning,
    })
}

fn valid_runtime_value(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && !value.contains("..")
        && value.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/' | ':'))
}

fn valid_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
}

fn is_git_repository(root: &Path) -> bool {
    if !root.join(".git").exists() {
        return false;
    }
    Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(root)
        .output()
        .map(|output| output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "true")
        .unwrap_or(false)
}

fn runtime_args(
    runtime: &str,
    resume: bool,
    external_session_id: Option<String>,
    model_ref: Option<String>,
    continuation_prompt: Option<String>,
) -> Result<Vec<String>, String> {
    if runtime != "opencode" {
        return Ok(Vec::new());
    }
    let mut args = Vec::new();
    if let Some(session_id) = external_session_id {
        if !valid_session_id(&session_id) {
            return Err("Unsafe OpenCode session id.".into());
        }
        args.extend(["--session".into(), session_id]);
    } else if resume {
        args.push("--continue".into());
    }
    if let Some(model) = model_ref {
        if !valid_runtime_value(&model, 256) {
            return Err("Unsafe OpenCode model reference.".into());
        }
        args.extend(["--model".into(), model]);
    }
    if let Some(prompt) = continuation_prompt {
        if prompt.len() > 65536 {
            return Err("OpenCode continuation prompt is too large.".into());
        }
        args.extend(["--prompt".into(), prompt]);
    }
    Ok(args)
}

/// Launches a known runtime with fixed, structured OpenCode flags and an
/// optional explicit bounded continuation prompt.
#[tauri::command]
pub fn launch_runtime(
    app: tauri::AppHandle,
    runtime: String,
    project_id: String,
    project_root: String,
    resume: bool,
    external_session_id: Option<String>,
    model_ref: Option<String>,
    continuation_prompt: Option<String>,
) -> Result<RuntimeLaunchResult, String> {
    let registered_root = crate::commands::fs::resolve_project_root(&app, &project_id)?;
    let registered_root_text = registered_root.to_string_lossy().into_owned();
    if registered_root_text != project_root {
        return Err(format!(
            "OpenCode launch blocked: supplied cwd {} differs from registered project root {}.",
            project_root, registered_root_text
        ));
    }
    launch_runtime_at_root(
        runtime,
        project_id,
        registered_root_text,
        resume,
        external_session_id,
        model_ref,
        continuation_prompt,
    )
}

fn visual_review_prompt(instruction: &str, criteria: &[String]) -> String {
    let criteria_text = criteria
        .iter()
        .map(|item| format!("- {}", item))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "{}\n\nUse only the single attached screenshot as visual evidence. Call the existing local qwen-mm-plugins-core read_image capability for that screenshot. Do not inspect the repository, source files, unrelated windows or other project context.\n\nStructured criteria:\n{}\n\nReturn exactly PASS, or FAIL followed by at most five numbered concrete issues. Do not add commentary before or after the required result.",
        instruction, criteria_text
    )
}

fn discover_visual_window(target: Option<&str>) -> Result<(String, String, String), String> {
    let script = r#"
on run argv
    set targetName to item 1 of argv
    tell application "System Events"
        if targetName is "" then
            set targetProcess to first application process whose frontmost is true
        else
            set targetProcess to first application process whose name is targetName
        end if
        set targetWindow to front window of targetProcess
        set windowNumber to value of attribute "AXWindowNumber" of targetWindow
        return (name of targetProcess) & tab & (name of targetWindow) & tab & (windowNumber as text)
    end tell
end run
"#;
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .arg("--")
        .arg(target.unwrap_or_default())
        .output()
        .map_err(|_| "The relevant visual window could not be identified.".to_string())?;
    if !output.status.success() {
        return Err("The relevant visual window could not be identified or is not permissioned.".into());
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let mut parts = value.split('\t');
    let application = parts.next().unwrap_or_default().trim();
    let title = parts.next().unwrap_or_default().trim();
    let window_id = parts.next().unwrap_or_default().trim();
    if application.is_empty()
        || title.is_empty()
        || window_id.is_empty()
        || !window_id.chars().all(|ch| ch.is_ascii_digit())
    {
        return Err("The relevant visual window could not be identified.".into());
    }
    Ok((application.into(), title.into(), window_id.into()))
}

/// Captures one relevant macOS window and routes it through the existing
/// OpenCode Qwen-MM Core capability. The screenshot is removed before return.
#[tauri::command]
pub fn run_visual_review(
    app: tauri::AppHandle,
    project_id: String,
    target: Option<String>,
    instruction: String,
    criteria: Vec<String>,
) -> Result<VisualReviewResult, String> {
    let project_root = crate::commands::fs::resolve_project_root(&app, &project_id)?;
    if instruction.trim().is_empty() || instruction.len() > 10_000 {
        return Err("Visual review instruction is invalid.".into());
    }
    if criteria.is_empty() || criteria.len() > 20 || criteria.iter().any(|item| item.is_empty() || item.len() > 500) {
        return Err("Visual review criteria are invalid.".into());
    }
    if target.as_ref().is_some_and(|value| value.len() > 200) {
        return Err("Visual review target is invalid.".into());
    }

    let (application, title, window_id) = discover_visual_window(target.as_deref())?;
    let visual_dir = env::temp_dir().join("promptforge-visual");
    std::fs::create_dir_all(&visual_dir)
        .map_err(|_| "The visual evidence directory could not be created.".to_string())?;
    let screenshot_path = visual_dir.join(format!("evidence-{}.png", std::process::id()));
    let capture = Command::new("/usr/sbin/screencapture")
        .args(["-x", "-o", &format!("-l{}", window_id)])
        .arg(&screenshot_path)
        .output()
        .map_err(|_| "The relevant visual surface could not be captured.".to_string());
    let result = capture.and_then(|output| {
        if !output.status.success() || !screenshot_path.is_file() {
            return Err("The relevant visual surface could not be captured.".into());
        }
        let executable = resolve_runtime_executable(
            "opencode",
            env::var_os("PATH").as_deref(),
            env::var_os("HOME").as_deref().map(Path::new),
        )
        .ok_or_else(|| "OpenCode visual review is unavailable.".to_string())?;
        let prompt = visual_review_prompt(&instruction, &criteria);
        let mut command = Command::new(executable);
        command
            .current_dir(&visual_dir)
            .args(["run", "--format", "default", "--file"])
            .arg(&screenshot_path)
            .args(["--prompt", &prompt]);
        if project_root.join("opencode.json").is_file() {
            command.env("OPENCODE_CONFIG", project_root.join("opencode.json"));
        } else if project_root.join("opencode.jsonc").is_file() {
            command.env("OPENCODE_CONFIG", project_root.join("opencode.jsonc"));
        }
        let review = command
            .output()
            .map_err(|_| "OpenCode visual review is unavailable.".to_string())?;
        if !review.status.success() {
            return Err("OpenCode visual review is unavailable.".into());
        }
        let output = String::from_utf8_lossy(&review.stdout).trim().to_string();
        if output.is_empty() || output.len() > 32_000 {
            return Err("OpenCode visual review returned no usable structured result.".into());
        }
        Ok(VisualReviewResult {
            output,
            target: format!("{} — {}", application, title),
            screenshot_captured: true,
        })
    });
    let _ = std::fs::remove_file(&screenshot_path);
    result
}

fn launch_runtime_at_root(
    runtime: String,
    project_id: String,
    project_root: String,
    resume: bool,
    external_session_id: Option<String>,
    model_ref: Option<String>,
    continuation_prompt: Option<String>,
) -> Result<RuntimeLaunchResult, String> {
    let cwd = PathBuf::from(&project_root);
    if !cwd.is_dir() {
        return Err(format!("Not a directory: {}", project_root));
    }
    let args = runtime_args(&runtime, resume, external_session_id, model_ref, continuation_prompt)?;
    if runtime == "opencode" && !is_git_repository(&cwd) {
        return Err(format!("OpenCode launch requires a Git repository: {}", project_root));
    }
    if project_id.is_empty() {
        return Err("OpenCode launch requires a registered project id.".into());
    }
    let binary = runtime_binary(&runtime).ok_or_else(|| format!("Unknown runtime: {}", runtime))?;
    let path_env = env::var_os("PATH");
    let home = env::var_os("HOME");
    let executable = resolve_runtime_executable(&runtime, path_env.as_deref(), home.as_deref().map(Path::new))
        .ok_or_else(|| format!("Unknown runtime: {}", runtime))?;
    let mut command = Command::new(executable);
    command.current_dir(&cwd);
    command.args(args);

    let mut child = command
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not launch {}: {}", binary, error))?;
    let pid = child.id();
    match child.try_wait().map_err(|error| format!("Could not verify {} launch: {}", binary, error))? {
        None => Ok(RuntimeLaunchResult { started: true, pid: Some(pid), exit_code: None, stderr: None }),
        Some(status) => {
            let stderr = child.stderr.as_mut().and_then(|pipe| {
                let mut text = String::new();
                pipe.read_to_string(&mut text).ok()?;
                let trimmed = text.trim().to_string();
                (!trimmed.is_empty()).then_some(trimmed)
            });
            Ok(RuntimeLaunchResult {
                started: false,
                pid: Some(pid),
                exit_code: status.code(),
                stderr,
            })
        }
    }
}

/// Open the default terminal at `project_root`.
#[tauri::command]
pub fn open_terminal(project_root: String) -> Result<(), String> {
    let path = PathBuf::from(&project_root);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", project_root));
    }
    Command::new("open")
        .args(["-a", "Terminal", &project_root])
        .spawn()
        .map_err(|e| format!("Could not open terminal: {}", e))?;
    Ok(())
}

/// Launch a CLI binary at `project_root`. No arguments, no prompt injection.
#[tauri::command]
pub fn launch_cli(binary_path: String, project_root: String) -> Result<(), String> {
    let cwd = PathBuf::from(&project_root);
    if !cwd.is_dir() {
        return Err(format!("Not a directory: {}", project_root));
    }

    // Reject shell metacharacters, traversal, and absolute paths.
    if binary_path.contains(';')
        || binary_path.contains('&')
        || binary_path.contains('|')
        || binary_path.contains('$')
        || binary_path.contains("..")
        || binary_path.starts_with('/')
    {
        return Err(format!("Unsafe binary path: {}", binary_path));
    }
    // Reject backtick separately (Rust char literal issue).
    if binary_path.contains('`') {
        return Err(format!("Unsafe binary path: {}", binary_path));
    }

    Command::new(&binary_path)
        .current_dir(&cwd)
        .spawn()
        .map_err(|e| format!("Could not launch CLI ({}): {}", binary_path, e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("promptforge-{}-{}-{}", label, std::process::id(), nonce))
    }

    fn write_executable(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"#!/bin/sh\nprintf 'OpenCode 1.15.10\\n'\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(path).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(path, permissions).unwrap();
        }
    }

    #[test]
    fn parses_plain_and_ansi_model_refs_without_duplicates() {
        let refs = parse_model_refs("\u{1b}[32mopenrouter/deepseek/deepseek-v4-pro\u{1b}[0m\nopenai/gpt-5.6\nopenai/gpt-5.6");
        assert_eq!(refs, vec![
            "openrouter/deepseek/deepseek-v4-pro".to_string(),
            "openai/gpt-5.6".to_string(),
        ]);
    }

    #[test]
    fn extracts_only_the_model_setting_from_jsonc() {
        let config = r#"{ "provider": { "openrouter": { "apiKey": "must-not-be-read" } }, "model": "openrouter/deepseek/deepseek-v4-pro" }"#;
        assert_eq!(extract_model_ref(config), Some("openrouter/deepseek/deepseek-v4-pro".into()));
        assert_eq!(extract_model_ref("\"model\": \"openrouter/deepseek/deepseek-v4-pro\","), Some("openrouter/deepseek/deepseek-v4-pro".into()));
    }

    #[test]
    fn model_ref_splits_provider_from_nested_model_id() {
        let model = model_from_ref("openrouter/deepseek/deepseek-v4-pro", true, true, "available").unwrap();
        assert_eq!(model.provider_id, "openrouter");
        assert_eq!(model.model_id, "deepseek/deepseek-v4-pro");
    }

    #[test]
    fn open_terminal_rejects_non_directory() {
        let err = open_terminal("/tmp/nonexistent-xyz-12345".into()).unwrap_err();
        assert!(err.contains("Not a directory"));
    }

    #[test]
    fn launch_cli_rejects_non_directory() {
        let err = launch_cli("echo".into(), "/tmp/nonexistent-xyz-12345".into()).unwrap_err();
        assert!(err.contains("Not a directory"));
    }

    #[test]
    fn launch_cli_rejects_semicolon_injection() {
        let err = launch_cli("echo; rm -rf /".into(), "/tmp".into()).unwrap_err();
        assert!(err.contains("Unsafe"));
    }

    #[test]
    fn launch_cli_rejects_pipe_injection() {
        let err = launch_cli("cat /etc/passwd | mail attacker".into(), "/tmp".into()).unwrap_err();
        assert!(err.contains("Unsafe"));
    }

    #[test]
    fn launch_cli_rejects_absolute_path() {
        let err = launch_cli("/bin/rm".into(), "/tmp".into()).unwrap_err();
        assert!(err.contains("Unsafe"));
    }

    #[test]
    fn launch_cli_rejects_dot_dot_traversal() {
        let err = launch_cli("../../../bin/evil".into(), "/tmp".into()).unwrap_err();
        assert!(err.contains("Unsafe"));
    }

    #[test]
    fn launch_cli_rejects_backtick_injection() {
        let err = launch_cli("echo `id`".into(), "/tmp".into()).unwrap_err();
        assert!(err.contains("Unsafe"));
    }

    #[test]
    fn launch_cli_rejects_dollar_injection() {
        let err = launch_cli("echo $HOME".into(), "/tmp".into()).unwrap_err();
        assert!(err.contains("Unsafe"));
    }

    #[test]
    fn runtime_status_exposes_opencode_capabilities_without_assuming_installation() {
        let status = runtime_status("opencode".into()).unwrap();
        assert_eq!(status.runtime, "opencode");
        assert!(status.supports_resume);
        assert!(status.supports_model_routing);
        assert!(status.capabilities.contains(&"structured-run-events".into()));
    }

    #[test]
    fn runtime_status_discovers_an_executable_from_path() {
        let root = test_root("path");
        let executable = root.join("bin/opencode");
        write_executable(&executable);

        let status = runtime_status_with_environment("opencode".into(), Some(root.join("bin").as_os_str()), None).unwrap();

        assert!(status.installed);
        assert_eq!(status.version.as_deref(), Some("OpenCode 1.15.10"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn runtime_status_discovers_the_user_local_opencode_installation_without_path() {
        let home = test_root("home");
        let executable = home.join(".opencode/bin/opencode");
        write_executable(&executable);

        let status = runtime_status_with_environment("opencode".into(), Some(Path::new("/path-without-opencode").as_os_str()), Some(&home)).unwrap();

        assert!(status.installed);
        assert_eq!(status.version.as_deref(), Some("OpenCode 1.15.10"));
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn missing_opencode_remains_not_detected() {
        let home = test_root("missing");
        std::fs::create_dir_all(&home).unwrap();
        let status = runtime_status_with_environment("opencode".into(), Some(Path::new("/path-without-opencode").as_os_str()), Some(&home)).unwrap();

        assert!(!status.installed);
        assert!(!status.can_launch);
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn user_local_path_is_derived_from_home_without_a_user_specific_literal() {
        assert_eq!(
            user_local_runtime_path("opencode", Some(Path::new("/Users/example"))),
            Some(PathBuf::from("/Users/example/.opencode/bin/opencode")),
        );
        assert_eq!(user_local_runtime_path("opencode", None), None);
    }

    #[test]
    fn packaged_app_resolution_has_standard_macos_fallbacks() {
        assert_eq!(
            standard_runtime_paths("opencode"),
            &[
                "/opt/homebrew/bin/opencode",
                "/usr/local/bin/opencode",
                "/usr/bin/opencode",
            ],
        );
        assert!(standard_runtime_paths("codex").is_empty());
    }

    #[test]
    fn runtime_status_rejects_unknown_runtime() {
        let err = runtime_status("unknown".into()).unwrap_err();
        assert!(err.contains("Unknown runtime"));
    }

    #[test]
    fn launch_runtime_rejects_unsafe_opencode_session_id() {
        let err = launch_runtime_at_root(
            "opencode".into(),
            "project-test".into(),
            "/tmp".into(),
            true,
            Some("session; rm -rf /".into()),
            None,
            None,
        ).unwrap_err();
        assert!(err.contains("Unsafe OpenCode session"));
    }

    #[test]
    fn launch_runtime_rejects_unsafe_opencode_model_reference() {
        let err = launch_runtime_at_root(
            "opencode".into(),
            "project-test".into(),
            "/tmp".into(),
            false,
            None,
            Some("provider/model --danger".into()),
            None,
        ).unwrap_err();
        assert!(err.contains("Unsafe OpenCode model"));
    }

    #[test]
    fn runtime_args_support_start_resume_and_model_routing() {
        assert_eq!(runtime_args("opencode", false, None, None, None).unwrap(), Vec::<String>::new());
        assert_eq!(runtime_args("opencode", true, None, None, None).unwrap(), vec!["--continue".to_string()]);
        assert_eq!(runtime_args("opencode", true, Some("ses_123".into()), Some("anthropic/claude-sonnet".into()), None).unwrap(), vec![
            "--session".to_string(), "ses_123".to_string(), "--model".to_string(), "anthropic/claude-sonnet".to_string(),
        ]);
    }

    #[test]
    fn runtime_args_support_optional_continuation_prompt() {
        assert_eq!(runtime_args("opencode", false, None, Some("provider/model".into()), Some("Continue this task.".into())).unwrap(), vec![
            "--model".to_string(), "provider/model".to_string(), "--prompt".to_string(), "Continue this task.".to_string(),
        ]);
    }

    #[test]
    fn runtime_args_reject_oversized_continuation_prompt() {
        let err = runtime_args("opencode", false, None, None, Some("x".repeat(65537))).unwrap_err();
        assert!(err.contains("too large"));
    }
}
