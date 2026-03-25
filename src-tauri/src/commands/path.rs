use std::path::{Path, PathBuf};

use tauri::{State, WebviewWindow, command};

use super::perf::measure_command;
use super::state::PerfState;
use super::state::ProjectRoot;

pub fn current_project_root(
    root: &State<'_, ProjectRoot>,
    window: &WebviewWindow,
) -> Result<PathBuf, String> {
    let lock = root.0.lock().map_err(|e| e.to_string())?;
    lock.get(window.label())
        .cloned()
        .ok_or("No project folder open".to_string())
}

fn ensure_within_root(root: &Path, candidate: &Path, relative: &str) -> Result<(), String> {
    let mut current = Some(candidate);

    while let Some(path) = current {
        if path.exists() {
            let canonical = path
                .canonicalize()
                .map_err(|e| format!("Cannot resolve path '{}': {}", relative, e))?;
            if !canonical.starts_with(root) {
                return Err(format!("Path '{}' escapes project root", relative));
            }
            return Ok(());
        }
        current = path.parent();
    }

    Err(format!("Path '{}' escapes project root", relative))
}

pub fn resolve_project_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let full = root.join(relative);
    // Canonicalize to resolve .. segments before the root check (#481).
    // Uses canonicalize_maybe_missing since the target may not exist yet.
    let canonical = canonicalize_maybe_missing(&full)
        .map_err(|_| format!("Path '{}' escapes project root", relative))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Cannot canonicalize root: {}", e))?;
    if !canonical.starts_with(&canonical_root) {
        return Err(format!("Path '{}' escapes project root", relative));
    }
    Ok(canonical)
}

pub fn resolve_existing_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let full = resolve_project_path(root, relative)?;
    let resolved = full
        .canonicalize()
        .map_err(|e| format!("Cannot resolve path '{}': {}", relative, e))?;
    if !resolved.starts_with(root) {
        return Err(format!("Path '{}' escapes project root", relative));
    }
    Ok(resolved)
}

/// Canonicalize a path that may not fully exist yet.
/// Walks up to the deepest existing ancestor, canonicalizes it,
/// then appends the remaining non-existent segments.
fn canonicalize_maybe_missing(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return path
            .canonicalize()
            .map_err(|e| format!("Cannot canonicalize '{}': {}", path.display(), e));
    }

    // Collect trailing segments that don't exist yet (owned, in reverse order)
    let mut tail_segments: Vec<std::ffi::OsString> = Vec::new();
    let mut ancestor = path.to_path_buf();
    loop {
        match ancestor.file_name() {
            Some(name) => {
                tail_segments.push(name.to_owned());
            }
            None => {
                // Reached filesystem root without finding an existing ancestor
                return Err(format!(
                    "No existing ancestor for '{}'",
                    path.display()
                ));
            }
        }
        ancestor = ancestor
            .parent()
            .expect("file_name() was Some so parent exists")
            .to_path_buf();
        if ancestor.exists() {
            let canonical_ancestor = ancestor
                .canonicalize()
                .map_err(|e| format!("Cannot canonicalize '{}': {}", ancestor.display(), e))?;
            let mut result = canonical_ancestor;
            for seg in tail_segments.iter().rev() {
                result.push(seg);
            }
            return Ok(result);
        }
    }
}

pub fn project_relative_path(root: &Path, candidate: &Path) -> Result<String, String> {
    let canonical_root = canonicalize_maybe_missing(root)
        .map_err(|_| format!("Cannot resolve project root '{}'", root.display()))?;
    let canonical_candidate = canonicalize_maybe_missing(candidate)
        .map_err(|_| format!("Path '{}' escapes project root", candidate.display()))?;

    let relative = canonical_candidate
        .strip_prefix(&canonical_root)
        .map_err(|_| format!("Path '{}' escapes project root", candidate.display()))?;

    Ok(relative
        .to_string_lossy()
        .replace('\\', "/"))
}

#[command]
pub fn to_project_relative_path(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<String, String> {
    measure_command(
        &perf,
        "tauri.to_project_relative_path",
        "tauri.path.to_project_relative_path",
        "tauri",
        Some(&path),
        || {
            let project_root = current_project_root(&root, &window)?;
            let candidate = PathBuf::from(&path);
            ensure_within_root(&project_root, &candidate, &path)?;
            project_relative_path(&project_root, &candidate)
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("coflat-{prefix}-{unique}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path.canonicalize().expect("canonicalize temp dir")
    }

    #[test]
    fn project_relative_path_with_canonical_paths() {
        let root = create_temp_dir("path-test");
        let file = root.join("sub/file.md");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "").unwrap();

        let result = project_relative_path(&root, &file).unwrap();
        assert_eq!(result, "sub/file.md");

        fs::remove_dir_all(&root).unwrap();
    }

    /// On macOS, /var is a symlink to /private/var. If the root is canonical
    /// (/private/var/...) but the candidate uses the non-canonical alias
    /// (/var/...), strip_prefix must still work after canonicalization.
    #[test]
    fn project_relative_path_with_symlink_alias() {
        // Create a real temp dir and a symlink alias to its parent
        let root = create_temp_dir("symlink-test");
        let file = root.join("doc.md");
        fs::write(&file, "").unwrap();

        let alias_parent = root.parent().unwrap().join("coflat-symlink-alias");
        // Clean up any stale symlink from a prior run
        let _ = fs::remove_file(&alias_parent);
        #[cfg(unix)]
        std::os::unix::fs::symlink(&root, &alias_parent).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&root, &alias_parent).unwrap();

        // The candidate uses the symlink alias, the root is canonical
        let aliased_candidate = alias_parent.join("doc.md");
        let result = project_relative_path(&root, &aliased_candidate).unwrap();
        assert_eq!(result, "doc.md");

        fs::remove_file(&alias_parent).unwrap();
        fs::remove_dir_all(&root).unwrap();
    }

    /// macOS-specific: /tmp -> /private/tmp, /var -> /private/var.
    /// The root (from open_folder) is canonical (/private/var/...),
    /// but the candidate from a file dialog may use /var/... .
    #[cfg(target_os = "macos")]
    #[test]
    fn project_relative_path_macos_var_alias() {
        // std::env::temp_dir() returns /var/folders/... on macOS (non-canonical),
        // canonicalize gives /private/var/folders/...
        let raw_tmp = std::env::temp_dir();
        let canonical_tmp = raw_tmp.canonicalize().unwrap();
        // Only run if they actually differ (the /var -> /private/var symlink exists)
        if raw_tmp == canonical_tmp {
            return;
        }

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir_name = format!("coflat-macos-alias-{unique}");

        // Root is canonical (/private/var/folders/.../coflat-macos-alias-...)
        let canonical_root = canonical_tmp.join(&dir_name);
        fs::create_dir_all(&canonical_root).unwrap();

        let file = canonical_root.join("notes.md");
        fs::write(&file, "").unwrap();

        // Candidate uses the non-canonical alias (/var/folders/.../coflat-macos-alias-.../notes.md)
        let aliased_candidate = raw_tmp.join(&dir_name).join("notes.md");

        let result = project_relative_path(&canonical_root, &aliased_candidate).unwrap();
        assert_eq!(result, "notes.md");

        fs::remove_dir_all(&canonical_root).unwrap();
    }

    #[test]
    fn project_relative_path_nonexistent_file() {
        let root = create_temp_dir("path-nonexist");

        // The parent exists but the file does not (save-as scenario)
        let candidate = root.join("new-file.md");
        let result = project_relative_path(&root, &candidate).unwrap();
        assert_eq!(result, "new-file.md");

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn project_relative_path_nonexistent_nested() {
        let root = create_temp_dir("path-nested");

        // Neither the file nor the intermediate directory exist
        let candidate = root.join("new-dir/deep/file.md");
        let result = project_relative_path(&root, &candidate).unwrap();
        assert_eq!(result, "new-dir/deep/file.md");

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn project_relative_path_rejects_outside_path() {
        let root = create_temp_dir("path-outside-root");
        let outside = create_temp_dir("path-outside-other");
        let candidate = outside.join("file.md");
        fs::write(&candidate, "").unwrap();

        let err = project_relative_path(&root, &candidate).expect_err("should reject");
        assert!(err.contains("escapes project root"));

        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn canonicalize_maybe_missing_existing_path() {
        let dir = create_temp_dir("canon-exist");
        let file = dir.join("test.txt");
        fs::write(&file, "").unwrap();

        let result = canonicalize_maybe_missing(&file).unwrap();
        assert_eq!(result, file.canonicalize().unwrap());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn canonicalize_maybe_missing_nonexistent_leaf() {
        let dir = create_temp_dir("canon-missing");
        let missing = dir.join("does-not-exist.md");

        let result = canonicalize_maybe_missing(&missing).unwrap();
        // The parent is canonical, so result = canonical_parent / "does-not-exist.md"
        assert_eq!(result, dir.join("does-not-exist.md"));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn canonicalize_maybe_missing_deep_nonexistent() {
        let dir = create_temp_dir("canon-deep");
        let deep = dir.join("a/b/c.md");

        let result = canonicalize_maybe_missing(&deep).unwrap();
        assert_eq!(result, dir.join("a/b/c.md"));

        fs::remove_dir_all(&dir).unwrap();
    }
}
