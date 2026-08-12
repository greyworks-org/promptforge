use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

// ---------------------------------------------------------------------------
// Project-root resolution (trust boundary)
// ---------------------------------------------------------------------------

/// Resolve a `projectId` to its canonical `repo_path` by querying the
/// central SQLite registry.  The frontend must not supply an arbitrary root;
/// every scoped fs command goes through this function.
pub(crate) fn resolve_project_root(app_handle: &tauri::AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let db_path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data directory: {}", e))?
        .join("promptforge.db");

    let conn = rusqlite::Connection::open(&db_path).map_err(|e| {
        format!(
            "Cannot open project registry at {}: {}",
            db_path.display(),
            e
        )
    })?;

    let repo_path: String = conn
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                format!("Unknown project: '{}'", project_id)
            }
            other => format!("Registry error for project '{}': {}", project_id, other),
        })?;

    // The stored path was canonicalized at registration time by fs_metadata.
    // Re-canonicalize here as a defence-in-depth check: the DB row could have
    // been tampered with outside the app.
    let canonical = std::fs::canonicalize(&repo_path).map_err(|e| {
        format!(
            "Registered project root for '{}' is no longer accessible ({}): {}",
            project_id, repo_path, e
        )
    })?;

    if !canonical.is_dir() {
        return Err(format!(
            "Registered project root for '{}' is not a directory: {}",
            project_id, repo_path
        ));
    }

    // Verify the anchor file ties this directory to the requested projectId.
    // Missing anchors are allowed (new provisional projects). Mismatched
    // anchors are rejected (SQL-only repo_path tampering — the attacker
    // can UPDATE the DB row but cannot also move the anchor file to the
    // redirected directory without filesystem access).
    verify_anchor(&canonical, project_id)?;

    Ok(canonical)
}

/// Read `.promptforge/project.json` inside `root` and confirm its
/// `projectId` field matches `expected_id`.
///
/// - **Missing anchor** → allowed (new provisional project, or the user
///   legitimately removed it).  The initial trust comes from registration-
///   time `fs_metadata` canonicalization.
/// - **Mismatched anchor** → rejected (the project registry's `repo_path`
///   was tampered with via SQL to point to a different project's directory).
/// - **Matching anchor** → allowed (normal active project).
fn verify_anchor(root: &Path, expected_id: &str) -> Result<(), String> {
    let anchor_path = root.join(".promptforge").join("project.json");

    let raw = match std::fs::read_to_string(&anchor_path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // New / provisional project — no anchor exists yet.
            return Ok(());
        }
        Err(e) => {
            return Err(format!(
                "Anchor file unreadable at {}: {}",
                anchor_path.display(),
                e
            ));
        }
    };

    // Minimal JSON parse — we only need the projectId field.
    let anchor_project_id = raw
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            if let Some(start) = trimmed.find("\"projectId\"") {
                let after_key = &trimmed[start + "\"projectId\"".len()..];
                let after_colon = after_key.trim_start().strip_prefix(':')?;
                // Strip surrounding whitespace, quotes, and trailing comma.
                let mut quoted = after_colon.trim().to_string();
                if quoted.ends_with(',') {
                    quoted.pop();
                    quoted = quoted.trim_end().to_string();
                }
                if quoted.starts_with('"') && quoted.ends_with('"') {
                    return Some(quoted[1..quoted.len() - 1].to_string());
                }
            }
            None
        })
        .unwrap_or_default();

    if anchor_project_id != expected_id {
        return Err(format!(
            "Anchor mismatch at {}: expected projectId '{}', found '{}'.  \
             The project registry may have been tampered with.",
            anchor_path.display(),
            expected_id,
            anchor_project_id
        ));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Shared helpers (unchanged from prior safety hardening)
// ---------------------------------------------------------------------------

/// Normalize a relative path: collapse `.` and `..` components without
/// touching the filesystem.  A `..` that would escape above the root is
/// treated as an escape.
fn normalize_relative(target: &str) -> Result<Vec<String>, String> {
    let mut stack: Vec<String> = Vec::new();
    for component in target.split('/') {
        match component {
            "" | "." => continue,
            ".." => {
                return Err(format!(
                    "Path escape blocked: '{}' contains parent traversal",
                    target
                ));
            }
            _ => stack.push(component.to_string()),
        }
    }
    Ok(stack)
}

fn check_containment(project_root: &Path, canonical: &Path, target: &str) -> Result<(), String> {
    if canonical == project_root {
        return Ok(());
    }
    let root_str = project_root.to_string_lossy();
    let root_with_sep = if root_str.ends_with('/') {
        root_str.into_owned()
    } else {
        format!("{}/", root_str)
    };
    let canon_str = canonical.to_string_lossy();
    if !canon_str.starts_with(&root_with_sep) {
        return Err(format!(
            "Path escape blocked: '{}' resolves outside the project root",
            target
        ));
    }
    Ok(())
}

fn resolve_scoped(project_root: &Path, target: &str) -> Result<PathBuf, String> {
    let target_path = Path::new(target);
    if target_path.is_absolute() {
        return Err(format!(
            "Path escape blocked: absolute path not allowed (received '{}')",
            target
        ));
    }
    if target.is_empty() {
        return Ok(project_root.to_path_buf());
    }

    let components = normalize_relative(target)?;
    let normalized: PathBuf = components.iter().collect();
    let joined = project_root.join(&normalized);

    if let Ok(canonical) = std::fs::canonicalize(&joined) {
        check_containment(project_root, &canonical, target)?;
        return Ok(canonical);
    }

    let mut ancestor: &Path = &joined;
    let mut tail: Vec<&std::ffi::OsStr> = Vec::new();

    loop {
        if ancestor.exists() || ancestor == project_root {
            break;
        }
        tail.push(ancestor.file_name().ok_or_else(|| {
            format!("Path has no filename component: {}", target)
        })?);
        ancestor = ancestor.parent().ok_or_else(|| {
            format!("Path escapes filesystem root: {}", target)
        })?;
    }

    let canonical_ancestor = std::fs::canonicalize(ancestor).map_err(|e| {
        format!(
            "Cannot resolve path '{}' under project root: {}",
            target, e
        )
    })?;

    check_containment(project_root, &canonical_ancestor, target)?;

    let mut resolved = canonical_ancestor;
    for component in tail.iter().rev() {
        resolved.push(component);
    }
    Ok(resolved)
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsMetadata {
    pub exists: bool,
    pub is_dir: bool,
    pub is_file: bool,
    pub readable: bool,
    pub canonical_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size_bytes: u64,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Pre-registration anchor read.  This is the **only** command that reads
/// a file outside a registered project.  It is restricted to
/// `.promptforge/project.json` files only and is used during onboarding to
/// detect re-link candidates before registration.
#[tauri::command]
pub fn fs_read_anchor(path: String) -> Result<Option<String>, String> {
    let p = PathBuf::from(&path);
    // Restrict: must be named project.json under a .promptforge directory.
    let filename = p.file_name().map(|f| f.to_string_lossy()).unwrap_or_default();
    if filename != "project.json" {
        return Err("fs_read_anchor can only read project.json files.".into());
    }
    let parent_name = p
        .parent()
        .and_then(|par| par.file_name())
        .map(|f| f.to_string_lossy())
        .unwrap_or_default();
    if parent_name != ".promptforge" {
        return Err("fs_read_anchor can only read files under a .promptforge directory.".into());
    }

    if !p.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&p)
        .map_err(|e| format!("Could not read anchor: {}", e))?;
    Ok(Some(content))
}

/// Pre-registration metadata probe.  Unscoped by design: this is the
/// gatekeeper that decides which folder may become a project root.
#[tauri::command]
pub fn fs_metadata(path: String) -> Result<FsMetadata, String> {
    let requested = PathBuf::from(&path);
    match std::fs::canonicalize(&requested) {
        Ok(canonical) => Ok(FsMetadata {
            exists: true,
            is_dir: canonical.is_dir(),
            is_file: canonical.is_file(),
            readable: canonical.is_file() && std::fs::File::open(&canonical).is_ok(),
            canonical_path: Some(canonical.to_string_lossy().into_owned()),
        }),
        Err(_) => Ok(FsMetadata {
            exists: requested.exists(),
            is_dir: false,
            is_file: false,
            readable: false,
            canonical_path: None,
        }),
    }
}

/// Return the canonical project root for a registered `projectId`.
/// The TS layer uses this for operations (directory traversal, path
/// building) that need to know the root without going through the scoped
/// fs commands for every component.
#[tauri::command]
pub fn fs_resolve_project_root(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<String, String> {
    let root = resolve_project_root(&app, &project_id)?;
    Ok(root.to_string_lossy().into_owned())
}

/// Inspect a path inside a registered project without reading or modifying it.
#[tauri::command]
pub fn fs_metadata_scoped(
    app: tauri::AppHandle,
    project_id: String,
    path: String,
) -> Result<FsMetadata, String> {
    let root = resolve_project_root(&app, &project_id)?;
    let resolved = resolve_scoped(&root, &path)?;
    match std::fs::metadata(&resolved) {
        Ok(metadata) => Ok(FsMetadata {
            exists: true,
            is_dir: metadata.is_dir(),
            is_file: metadata.is_file(),
            readable: metadata.is_file() && std::fs::File::open(&resolved).is_ok(),
            canonical_path: None,
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(FsMetadata {
            exists: false,
            is_dir: false,
            is_file: false,
            readable: false,
            canonical_path: None,
        }),
        Err(error) => Err(format!("Could not inspect {}: {}", path, error)),
    }
}

/// Read a text file scoped to a registered project.  `path` must be
/// relative; it is resolved and verified inside the canonical project root.
#[tauri::command]
pub fn fs_read_text(
    app: tauri::AppHandle,
    project_id: String,
    path: String,
) -> Result<String, String> {
    let root = resolve_project_root(&app, &project_id)?;
    let resolved = resolve_scoped(&root, &path)?;
    let content =
        std::fs::read_to_string(&resolved).map_err(|e| format!("Could not read {}: {}", path, e))?;
    Ok(content)
}

/// Write text content to a file scoped to a registered project.  `path` must
/// be relative.  Overwrite is denied unless `allowOverwrite: Some(true)` is
/// supplied after TS-side user consent.
#[tauri::command]
pub fn fs_write_text(
    app: tauri::AppHandle,
    project_id: String,
    path: String,
    content: String,
    allow_overwrite: Option<bool>,
) -> Result<(), String> {
    let root = resolve_project_root(&app, &project_id)?;
    let resolved = resolve_scoped(&root, &path)?;

    let overwrite_ok = allow_overwrite.unwrap_or(false);
    if resolved.exists() && !overwrite_ok {
        return Err(format!(
            "File already exists and overwrite is not allowed: {}",
            path
        ));
    }

    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Could not create parent directories for {}: {}",
                path, e
            )
        })?;
    }
    std::fs::write(&resolved, &content)
        .map_err(|e| format!("Could not write {}: {}", path, e))?;
    Ok(())
}

/// List directory contents scoped to a registered project.  Non-recursive.
#[tauri::command]
pub fn fs_list_dir(
    app: tauri::AppHandle,
    project_id: String,
    path: String,
) -> Result<Vec<DirEntry>, String> {
    let root = resolve_project_root(&app, &project_id)?;
    let resolved = if path.is_empty() {
        root.clone()
    } else {
        resolve_scoped(&root, &path)?
    };

    if !resolved.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }
    let mut entries: Vec<DirEntry> = Vec::new();
    let read = std::fs::read_dir(&resolved)
        .map_err(|e| format!("Could not read directory {}: {}", path, e))?;
    for entry in read {
        let entry =
            entry.map_err(|e| format!("Error reading entry in {}: {}", path, e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let md = entry
            .metadata()
            .map_err(|e| format!("Could not stat {}: {}", name, e))?;
        entries.push(DirEntry {
            name,
            is_dir: md.is_dir(),
            size_bytes: md.len(),
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// Check whether a path exists, scoped to a registered project.
#[tauri::command]
pub fn fs_exists(
    app: tauri::AppHandle,
    project_id: String,
    path: String,
) -> Result<bool, String> {
    let root = resolve_project_root(&app, &project_id)?;
    if path.is_empty() {
        return Ok(true);
    }
    let resolved = resolve_scoped(&root, &path)?;
    Ok(resolved.exists())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix;

    fn unique_temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pf-fs-{}-{}",
            std::process::id(),
            name
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn root_str(dir: &PathBuf) -> String {
        dir.to_string_lossy().into_owned()
    }

    fn write(dir: &PathBuf, rel: &str, content: &str) {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, content).unwrap();
    }

    // -- fs_metadata (unchanged) --

    #[test]
    fn metadata_existing_directory() {
        let dir = unique_temp("meta-dir");
        let meta = fs_metadata(root_str(&dir)).expect("command runs");
        assert!(meta.exists);
        assert!(meta.is_dir);
        assert!(meta.canonical_path.is_some());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn metadata_missing_path() {
        let missing = std::env::temp_dir().join(format!("pf-fs-missing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&missing);
        let meta = fs_metadata(missing.to_string_lossy().into_owned()).expect("command runs");
        assert!(!meta.exists);
        assert!(!meta.is_dir);
        assert!(meta.canonical_path.is_none());
    }

    #[test]
    fn metadata_file_not_dir() {
        let dir = unique_temp("meta-file");
        let file = dir.join("plain.txt");
        std::fs::write(&file, "x").expect("write file");
        let meta = fs_metadata(file.to_string_lossy().into_owned()).expect("command runs");
        assert!(meta.exists);
        assert!(!meta.is_dir);
        assert!(meta.is_file);
        assert!(meta.readable);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn metadata_resolves_dots() {
        let dir = unique_temp("meta-dots");
        let messy = format!("{}/./", root_str(&dir));
        let meta = fs_metadata(messy).expect("command runs");
        assert!(meta.exists);
        assert!(meta.is_dir);
        assert_eq!(
            meta.canonical_path,
            Some(dir.canonicalize().unwrap().to_string_lossy().into_owned())
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    // -- resolve_scoped (core containment logic — all guarantees live here) --

    #[test]
    fn scoped_rejects_absolute_path() {
        let dir = unique_temp("sc-abs");
        let err = resolve_scoped(&dir, "/etc/passwd").unwrap_err();
        assert!(err.contains("absolute path"), "got: {}", err);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scoped_rejects_dot_dot_above_root() {
        let dir = unique_temp("sc-dd");
        let err = resolve_scoped(&dir, "sub/../../../etc").unwrap_err();
        assert!(err.contains("escape"), "got: {}", err);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scoped_rejects_symlink_escape() {
        let dir = unique_temp("sc-sym");
        let target = std::env::temp_dir().join(format!("pf-scsym-{}", std::process::id()));
        std::fs::write(&target, "secret").unwrap();
        let link = dir.join("escape");
        unix::fs::symlink(&target, &link).unwrap();
        let err = resolve_scoped(&dir, "escape").unwrap_err();
        assert!(err.contains("outside"), "got: {}", err);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_file(&target).ok();
    }

    #[test]
    fn scoped_allows_normal_relative_path() {
        let dir = unique_temp("sc-ok");
        write(&dir, "src/main.ts", "x");
        // Pass the canonicalized root so containment checks match.
        let canonical_root = dir.canonicalize().unwrap();
        let resolved = resolve_scoped(&canonical_root, "src/main.ts").unwrap();
        assert!(resolved.ends_with("src/main.ts"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scoped_handles_non_existent_path() {
        let dir = unique_temp("sc-new");
        let canonical_root = dir.canonicalize().unwrap();
        let resolved = resolve_scoped(&canonical_root, "a/b/c/new.txt").unwrap();
        assert!(resolved.ends_with("a/b/c/new.txt"));
        assert!(resolved.starts_with(&canonical_root));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scoped_empty_path_returns_root() {
        let dir = unique_temp("sc-empty");
        let canonical_root = dir.canonicalize().unwrap();
        let resolved = resolve_scoped(&canonical_root, "").unwrap();
        assert_eq!(resolved, canonical_root);
        std::fs::remove_dir_all(&dir).ok();
    }

    // -- containment check --

    #[test]
    fn containment_rejects_outside_path() {
        let root = Path::new("/tmp/project-a");
        let outside = Path::new("/tmp/project-b/file.txt");
        let err = check_containment(root, outside, "test").unwrap_err();
        assert!(err.contains("outside"), "got: {}", err);
    }

    #[test]
    fn containment_accepts_child() {
        let root = Path::new("/tmp/project-a");
        let child = Path::new("/tmp/project-a/src/main.ts");
        assert!(check_containment(root, child, "src/main.ts").is_ok());
    }

    #[test]
    fn containment_accepts_root_itself() {
        let root = Path::new("/tmp/project-a");
        assert!(check_containment(root, root, "").is_ok());
    }

    // -- normalize_relative --

    #[test]
    fn normalize_rejects_any_parent_traversal() {
        let err = normalize_relative("a/b/../c").unwrap_err();
        assert!(err.contains("parent traversal"), "got: {}", err);
    }

    #[test]
    fn normalize_rejects_escape_above() {
        let err = normalize_relative("../outside").unwrap_err();
        assert!(err.contains("escape"), "got: {}", err);
    }

    #[test]
    fn normalize_removes_dot_components() {
        let result = normalize_relative("./a/./b/.").unwrap();
        assert_eq!(result, vec!["a", "b"]);
    }

    #[test]
    fn normalize_rejects_double_escape() {
        let err = normalize_relative("a/../../outside").unwrap_err();
        assert!(err.contains("escape"), "got: {}", err);
    }

    // -- verify_anchor (registry-tampering guard) --

    fn write_anchor_file(dir: &Path, project_id: &str, name: &str) {
        let anchor_dir = dir.join(".promptforge");
        std::fs::create_dir_all(&anchor_dir).unwrap();
        let json = format!(
            "{{\n  \"schema\": \"promptforge.anchor/1\",\n  \"projectId\": \"{}\",\n  \"name\": \"{}\",\n  \"createdAt\": \"2026-08-07T00:00:00Z\"\n}}\n",
            project_id, name
        );
        std::fs::write(anchor_dir.join("project.json"), json).unwrap();
    }

    #[test]
    fn verify_anchor_accepts_matching_id() {
        let dir = unique_temp("vfy-ok");
        write_anchor_file(&dir, "project-test", "Test");
        verify_anchor(&dir, "project-test").unwrap();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn verify_anchor_allows_missing_anchor() {
        let dir = unique_temp("vfy-miss");
        // No anchor at all — allowed (new provisional project).
        verify_anchor(&dir, "project-x").unwrap();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn verify_anchor_rejects_mismatched_project_id() {
        let dir = unique_temp("vfy-mism");
        write_anchor_file(&dir, "project-real", "Real");
        let err = verify_anchor(&dir, "project-attacker").unwrap_err();
        assert!(err.contains("mismatch"), "got: {}", err);
        assert!(err.contains("project-real"), "got: {}", err);
        assert!(err.contains("project-attacker"), "got: {}", err);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn verify_anchor_rejects_cross_project_id() {
        // Project A's anchor cannot satisfy a request for project B.
        let dir_a = unique_temp("vfy-a");
        let dir_b = unique_temp("vfy-b");
        write_anchor_file(&dir_a, "project-a", "A");
        write_anchor_file(&dir_b, "project-b", "B");
        // Verify dir_a with project-b → should fail.
        let err = verify_anchor(&dir_a, "project-b").unwrap_err();
        assert!(err.contains("mismatch"), "got: {}", err);
        // Verify dir_b with project-a → should fail.
        let err2 = verify_anchor(&dir_b, "project-a").unwrap_err();
        assert!(err2.contains("mismatch"), "got: {}", err2);
        std::fs::remove_dir_all(&dir_a).ok();
        std::fs::remove_dir_all(&dir_b).ok();
    }

    #[test]
    fn verify_anchor_rejects_unparseable_json() {
        let dir = unique_temp("vfy-bad");
        let anchor_dir = dir.join(".promptforge");
        std::fs::create_dir_all(&anchor_dir).unwrap();
        std::fs::write(anchor_dir.join("project.json"), "not json {{{").unwrap();
        let err = verify_anchor(&dir, "any-id").unwrap_err();
        assert!(err.contains("mismatch"), "got: {}", err);
        std::fs::remove_dir_all(&dir).ok();
    }
}
