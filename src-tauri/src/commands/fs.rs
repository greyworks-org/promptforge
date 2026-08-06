use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsMetadata {
    pub exists: bool,
    pub is_dir: bool,
    pub canonical_path: Option<String>,
}

/// Read-only metadata probe used to validate and canonicalize a project
/// folder before it is registered. Never writes to the path.
#[tauri::command]
pub fn fs_metadata(path: String) -> Result<FsMetadata, String> {
    let requested = PathBuf::from(&path);
    match std::fs::canonicalize(&requested) {
        Ok(canonical) => Ok(FsMetadata {
            exists: true,
            is_dir: canonical.is_dir(),
            canonical_path: Some(canonical.to_string_lossy().into_owned()),
        }),
        Err(_) => Ok(FsMetadata {
            exists: requested.exists(),
            is_dir: false,
            canonical_path: None,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "promptforge-fs-test-{}-{}",
            std::process::id(),
            name
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn reports_existing_directory() {
        let dir = unique_temp("dir");
        let meta = fs_metadata(dir.to_string_lossy().into_owned()).expect("command runs");
        assert!(meta.exists);
        assert!(meta.is_dir);
        let canonical = meta.canonical_path.expect("canonical path present");
        assert!(PathBuf::from(&canonical).is_dir());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reports_missing_path() {
        let missing = std::env::temp_dir().join(format!("promptforge-fs-missing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&missing);
        let meta = fs_metadata(missing.to_string_lossy().into_owned()).expect("command runs");
        assert!(!meta.exists);
        assert!(!meta.is_dir);
        assert!(meta.canonical_path.is_none());
    }

    #[test]
    fn reports_file_as_not_a_directory() {
        let dir = unique_temp("file");
        let file = dir.join("plain.txt");
        std::fs::write(&file, "x").expect("write file");
        let meta = fs_metadata(file.to_string_lossy().into_owned()).expect("command runs");
        assert!(meta.exists);
        assert!(!meta.is_dir);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolves_dot_segments_and_trailing_slash() {
        let dir = unique_temp("dots");
        let messy = format!("{}/./", dir.to_string_lossy());
        let meta = fs_metadata(messy).expect("command runs");
        assert!(meta.exists);
        assert!(meta.is_dir);
        assert_eq!(
            meta.canonical_path,
            Some(dir.canonicalize().expect("canonicalize").to_string_lossy().into_owned())
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
