use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

/// Structured output of `git_inspect`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInspectResult {
    pub is_repo: bool,
    pub head: Option<GitHead>,
    pub staged: Vec<String>,
    pub unstaged: Vec<String>,
    pub untracked: Vec<String>,
    pub diff_stat: String,
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHead {
    pub hash: String,
    pub subject: String,
    pub committed_at: String,
}

/// Allowed git commands (read-only, metadata only).
const ALLOWED_COMMANDS: &[&str] = &["log", "status", "diff", "rev-parse"];
/// Mutating git verbs — explicitly blocked.
const BLOCKED_VERBS: &[&str] = &[
    "commit", "add", "rm", "mv", "reset", "stash", "checkout", "switch",
    "restore", "rebase", "merge", "cherry-pick", "revert", "push", "fetch",
    "pull", "tag", "branch", "clean", "gc", "prune", "clone", "init",
    "submodule", "worktree", "bisect", "blame",
];

fn is_safe_command(args: &[&str]) -> bool {
    if args.is_empty() { return false; }
    let verb = args[0];
    if BLOCKED_VERBS.contains(&verb) { return false; }
    if !ALLOWED_COMMANDS.contains(&verb) { return false; }

    // Block arguments that could escape the project repo.
    for a in args {
        // Mutating flags.
        if *a == "--force" || *a == "-f" || *a == "--hard" { return false; }
        // Filesystem-escape flags.
        if *a == "--no-index" || *a == "--git-dir" || *a == "--work-tree" { return false; }
        // Short-form directory change.
        if *a == "-C" { return false; }
        // Absolute paths or traversal.
        if a.starts_with('/') || a.contains("../") { return false; }
    }
    true
}

fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    if !is_safe_command(args) {
        return Err(format!("git {} is not allowed (read-only metadata only)", args.join(" ")));
    }
    let output = Command::new("git")
        .args(args)
        .current_dir(PathBuf::from(repo_path))
        .output()
        .map_err(|e| format!("git command failed: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git error: {}", stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Read-only git inspection.  Returns structured metadata only — never
/// file contents.  Non-git folders return `isRepo: false`.
#[tauri::command]
pub fn git_inspect(repo_path: String) -> Result<GitInspectResult, String> {
    // Check whether the directory is a git repo.
    let is_repo = match run_git(&repo_path, &["rev-parse", "--is-inside-work-tree"]) {
        Ok(o) => o.trim() == "true",
        Err(_) => false,
    };

    if !is_repo {
        return Ok(GitInspectResult {
            is_repo: false,
            head: None,
            staged: vec![],
            unstaged: vec![],
            untracked: vec![],
            diff_stat: String::new(),
            branch: None,
        });
    }

    let head = run_git(&repo_path, &["log", "-1", "--format=%H%n%s%n%cI"])
        .ok()
        .and_then(|s| {
            let lines: Vec<&str> = s.lines().collect();
            if lines.len() >= 3 {
                Some(GitHead {
                    hash: lines[0].to_string(),
                    subject: lines[1].to_string(),
                    committed_at: lines[2].to_string(),
                })
            } else {
                None
            }
        });

    let branch = run_git(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"]).ok();

    // Parse status --porcelain=v1 for staged/unstaged/untracked.
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();

    if let Ok(status) = run_git(&repo_path, &["status", "--porcelain=v1"]) {
        for line in status.lines() {
            if line.len() < 3 { continue; }
            let idx = &line[0..2];
            let path = line[3..].trim().to_string();
            // Truncate path lists at 500 entries to bound output.
            match idx {
                "??" if untracked.len() < 500 => untracked.push(path),
                _ if idx.contains('?') => {} // skip
                _ => {
                    let is_staged = idx.chars().next().map_or(false, |c| c != ' ');
                    let is_unstaged = idx.chars().nth(1).map_or(false, |c| c != ' ');
                    if is_staged && staged.len() < 500 {
                        staged.push(path.clone());
                    }
                    if is_unstaged && unstaged.len() < 500 {
                        unstaged.push(path);
                    }
                }
            }
        }
    }

    let diff_stat = run_git(&repo_path, &["diff", "--stat"]).unwrap_or_default();

    Ok(GitInspectResult {
        is_repo: true,
        head,
        staged,
        unstaged,
        untracked,
        diff_stat,
        branch,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_mutating_verbs() {
        assert!(!is_safe_command(&["commit", "-m", "x"]));
        assert!(!is_safe_command(&["push"]));
        assert!(!is_safe_command(&["reset"]));
        assert!(!is_safe_command(&["checkout"]));
        assert!(!is_safe_command(&["stash"]));
        assert!(!is_safe_command(&["add", "."]));
        assert!(!is_safe_command(&["merge"]));
        assert!(!is_safe_command(&["rebase"]));
        assert!(!is_safe_command(&["clean"]));
    }

    #[test]
    fn allows_readonly_verbs() {
        assert!(is_safe_command(&["log", "-1"]));
        assert!(is_safe_command(&["status", "--porcelain=v1"]));
        assert!(is_safe_command(&["diff", "--stat"]));
        assert!(is_safe_command(&["rev-parse", "HEAD"]));
    }

    #[test]
    fn blocks_force_flags() {
        assert!(!is_safe_command(&["log", "--force"]));
        assert!(!is_safe_command(&["diff", "-f"]));
        assert!(!is_safe_command(&["status", "--hard"]));
    }

    #[test]
    fn blocks_empty_args() {
        assert!(!is_safe_command(&[]));
    }

    #[test]
    fn blocks_unknown_verbs() {
        assert!(!is_safe_command(&["config"]));
        assert!(!is_safe_command(&["remote"]));
    }

    #[test]
    fn non_repo_returns_is_repo_false() {
        let result = git_inspect("/tmp".into()).unwrap();
        assert!(!result.is_repo);
    }

    #[test]
    fn blocks_git_dir_flag() {
        assert!(!is_safe_command(&["log", "--git-dir", "/etc"]));
    }

    #[test]
    fn blocks_work_tree_flag() {
        assert!(!is_safe_command(&["status", "--work-tree", "/tmp"]));
    }

    #[test]
    fn blocks_no_index_flag() {
        assert!(!is_safe_command(&["diff", "--no-index", "/etc/passwd"]));
    }

    #[test]
    fn blocks_c_flag() {
        assert!(!is_safe_command(&["log", "-C", "/etc"]));
    }

    #[test]
    fn blocks_absolute_path_arg() {
        assert!(!is_safe_command(&["log", "/etc/passwd"]));
    }

    #[test]
    fn blocks_dot_dot_traversal() {
        assert!(!is_safe_command(&["log", "../../../etc/passwd"]));
    }

    #[test]
    fn allows_relative_path() {
        assert!(is_safe_command(&["log", "--", "src/main.rs"]));
    }
}
