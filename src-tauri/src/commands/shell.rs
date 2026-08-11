use std::path::PathBuf;
use std::process::Command;
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

fn runtime_binary(runtime: &str) -> Option<&'static str> {
    match runtime {
        "claude-code" => Some("claude"),
        "qwen-code" => Some("qwen"),
        "codex" => Some("codex"),
        "opencode" => Some("opencode"),
        _ => None,
    }
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
    let binary = runtime_binary(&runtime)
        .ok_or_else(|| format!("Unknown runtime: {}", runtime))?;
    let (supports_resume, supports_model_routing, capabilities) = runtime_capabilities(&runtime);
    match Command::new(binary).arg("--version").output() {
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

fn runtime_args(
    runtime: &str,
    resume: bool,
    external_session_id: Option<String>,
    model_ref: Option<String>,
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
    Ok(args)
}

/// Launches a known runtime with only fixed, structured OpenCode flags.
/// PromptForge never injects task text into this process.
#[tauri::command]
pub fn launch_runtime(
    runtime: String,
    project_root: String,
    resume: bool,
    external_session_id: Option<String>,
    model_ref: Option<String>,
) -> Result<(), String> {
    let cwd = PathBuf::from(&project_root);
    if !cwd.is_dir() {
        return Err(format!("Not a directory: {}", project_root));
    }
    let binary = runtime_binary(&runtime).ok_or_else(|| format!("Unknown runtime: {}", runtime))?;
    let mut command = Command::new(binary);
    command.current_dir(&cwd);
    command.args(runtime_args(&runtime, resume, external_session_id, model_ref)?);

    command.spawn().map_err(|error| format!("Could not launch {}: {}", binary, error))?;
    Ok(())
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
    fn runtime_status_rejects_unknown_runtime() {
        let err = runtime_status("unknown".into()).unwrap_err();
        assert!(err.contains("Unknown runtime"));
    }

    #[test]
    fn launch_runtime_rejects_unsafe_opencode_session_id() {
        let err = launch_runtime(
            "opencode".into(),
            "/tmp".into(),
            true,
            Some("session; rm -rf /".into()),
            None,
        ).unwrap_err();
        assert!(err.contains("Unsafe OpenCode session"));
    }

    #[test]
    fn launch_runtime_rejects_unsafe_opencode_model_reference() {
        let err = launch_runtime(
            "opencode".into(),
            "/tmp".into(),
            false,
            None,
            Some("provider/model --danger".into()),
        ).unwrap_err();
        assert!(err.contains("Unsafe OpenCode model"));
    }

    #[test]
    fn runtime_args_support_start_resume_and_model_routing() {
        assert_eq!(runtime_args("opencode", false, None, None).unwrap(), Vec::<String>::new());
        assert_eq!(runtime_args("opencode", true, None, None).unwrap(), vec!["--continue".to_string()]);
        assert_eq!(runtime_args("opencode", true, Some("ses_123".into()), Some("anthropic/claude-sonnet".into())).unwrap(), vec![
            "--session".to_string(), "ses_123".to_string(), "--model".to_string(), "anthropic/claude-sonnet".to_string(),
        ]);
    }
}
