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
    // Preserve leading spaces: porcelain status uses them to encode the
    // index state. Trimming them drops the first character of a path.
    Ok(String::from_utf8_lossy(&output.stdout).trim_end().to_string())
}

/// Read-only git inspection.  Returns structured metadata only — never
/// file contents.  Non-git folders return `isRepo: false`.
///
/// Explicit trust rule (no implicit monorepo inheritance):
/// - `.git` directory inside project root → allow (own repo)
/// - `.git` file inside project root → allow (worktree / submodule)
/// - `.git` found in a parent directory → reject (no implicit trust)
/// - no `.git` → graceful fallback
#[tauri::command]
pub fn git_inspect(repo_path: String) -> Result<GitInspectResult, String> {
    let project_root = PathBuf::from(&repo_path);

    // Only trust .git that lives INSIDE the project root.
    let dot_git = project_root.join(".git");
    let is_repo = if dot_git.exists() {
        match run_git(&repo_path, &["rev-parse", "--is-inside-work-tree"]) {
            Ok(o) => o.trim() == "true",
            Err(_) => false,
        }
    } else {
        false
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

    fn tmp_git_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pf-git-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn own_git_repo_detected() {
        let dir = tmp_git_dir("own-repo");
        Command::new("git").args(["init"]).current_dir(&dir).status().unwrap();
        let result = git_inspect(dir.to_string_lossy().into_owned()).unwrap();
        assert!(result.is_repo);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn preserves_modified_path_prefix_from_porcelain_status() {
        let dir = tmp_git_dir("path-preservation");
        Command::new("git").args(["init"]).current_dir(&dir).status().unwrap();
        Command::new("git").args(["-c", "user.name=PromptForge", "-c", "user.email=test@example.com", "add", "."])
            .current_dir(&dir).status().unwrap();
        std::fs::create_dir_all(dir.join("App")).unwrap();
        std::fs::write(dir.join("App/AppModel.swift"), "struct AppModel {}\n").unwrap();
        Command::new("git").args(["add", "App/AppModel.swift"]).current_dir(&dir).status().unwrap();
        Command::new("git").args(["-c", "user.name=PromptForge", "-c", "user.email=test@example.com", "commit", "-m", "baseline"])
            .current_dir(&dir).status().unwrap();
        std::fs::write(dir.join("App/AppModel.swift"), "struct AppModel { let ready = true }\n").unwrap();

        let result = git_inspect(dir.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.unstaged, vec!["App/AppModel.swift"]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn no_dot_git_returns_false() {
        let dir = tmp_git_dir("no-repo");
        let result = git_inspect(dir.to_string_lossy().into_owned()).unwrap();
        assert!(!result.is_repo);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn monorepo_child_without_own_dot_git_rejected() {
        // /repo/.git, /repo/apps/mobile → NO .git inside mobile.
        // Without explicit trust, this is rejected. Monorepo trust requires
        // explicit workspace binding, not directory ancestry.
        let repo = tmp_git_dir("mono-reject");
        Command::new("git").args(["init"]).current_dir(&repo).status().unwrap();
        let child = repo.join("apps").join("mobile");
        std::fs::create_dir_all(&child).unwrap();
        let result = git_inspect(child.to_string_lossy().into_owned()).unwrap();
        assert!(!result.is_repo, "monorepo child without own .git must be rejected");
        std::fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn arbitrary_parent_repo_rejected() {
        // Simulate any non-home parent: /tmp/repo/.git, /tmp/repo/child.
        // Child has no .git → must be rejected regardless of parent identity.
        let parent = tmp_git_dir("arb-parent");
        Command::new("git").args(["init"]).current_dir(&parent).status().unwrap();
        let child = parent.join("child-project");
        std::fs::create_dir_all(&child).unwrap();
        let result = git_inspect(child.to_string_lossy().into_owned()).unwrap();
        assert!(!result.is_repo, "arbitrary parent repo must be rejected");
        std::fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn submodule_with_gitfile_allowed() {
        // Simulate a git worktree: child has .git file, parent is a real repo.
        let repo = tmp_git_dir("worktree-main");
        Command::new("git").args(["init"]).current_dir(&repo).status().unwrap();
        // Create a linked worktree directory with a .git file.
        let wt = repo.join("wt");
        std::fs::create_dir_all(&wt).unwrap();
        let gitdir_path = repo.join(".git").join("worktrees").join("wt");
        std::fs::create_dir_all(&gitdir_path).unwrap();
        // Minimal valid gitdir: needs HEAD + commondir.
        std::fs::write(gitdir_path.join("HEAD"), "ref: refs/heads/main").unwrap();
        std::fs::write(gitdir_path.join("commondir"), format!("{}/.git\n", repo.to_string_lossy())).unwrap();
        std::fs::write(
            wt.join(".git"),
            format!("gitdir: {}\n", gitdir_path.to_string_lossy()),
        ).unwrap();
        let result = git_inspect(wt.to_string_lossy().into_owned()).unwrap();
        assert!(result.is_repo, "worktree with .git file should be a repo");
        std::fs::remove_dir_all(&repo).ok();
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
