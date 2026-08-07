use std::path::PathBuf;
use std::process::Command;

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
}
