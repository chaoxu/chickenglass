use std::path::{Path, PathBuf};

pub fn resolve_project_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let full = root.join(relative);
    // Resolve `..` and symlink aliases before checking project-root containment.
    let canonical = canonicalize_maybe_missing(&full)
        .map_err(|e| format!("Cannot resolve path '{}': {}", relative, e))?;
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
    if !full.exists() {
        return Err(format!(
            "Cannot resolve path '{}': No such file or directory",
            relative
        ));
    }
    Ok(full)
}

pub fn project_relative_path(root: &Path, candidate: &Path) -> Result<String, String> {
    let canonical_root = canonicalize_maybe_missing(root)
        .map_err(|_| format!("Cannot resolve project root '{}'", root.display()))?;
    let canonical_candidate = canonicalize_maybe_missing(candidate)
        .map_err(|_| format!("Path '{}' escapes project root", candidate.display()))?;

    let relative = canonical_candidate
        .strip_prefix(&canonical_root)
        .map_err(|_| format!("Path '{}' escapes project root", candidate.display()))?;

    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn canonicalize_maybe_missing(path: &Path) -> Result<PathBuf, String> {
    let mut tail_segments: Vec<std::ffi::OsString> = Vec::new();
    let mut ancestor = path.to_path_buf();
    loop {
        match std::fs::symlink_metadata(&ancestor) {
            Ok(_) => {
                let canonical_ancestor = ancestor
                    .canonicalize()
                    .map_err(|e| format!("Cannot canonicalize '{}': {}", ancestor.display(), e))?;
                let mut result = canonical_ancestor;
                for seg in tail_segments.iter().rev() {
                    result.push(seg);
                }
                return Ok(result);
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => match ancestor.file_name() {
                Some(name) => {
                    tail_segments.push(name.to_owned());
                    ancestor = ancestor
                        .parent()
                        .expect("file_name() was Some so parent exists")
                        .to_path_buf();
                }
                None => {
                    return Err(format!("No existing ancestor for '{}'", path.display()));
                }
            },
            Err(err) => {
                return Err(format!("Cannot inspect '{}': {}", ancestor.display(), err));
            }
        }
    }
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

    #[test]
    fn project_relative_path_with_symlink_alias() {
        let root = create_temp_dir("symlink-test");
        let file = root.join("doc.md");
        fs::write(&file, "").unwrap();

        let alias_parent = root.parent().unwrap().join("coflat-symlink-alias");
        let _ = fs::remove_file(&alias_parent);
        #[cfg(unix)]
        std::os::unix::fs::symlink(&root, &alias_parent).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&root, &alias_parent).unwrap();

        let aliased_candidate = alias_parent.join("doc.md");
        let result = project_relative_path(&root, &aliased_candidate).unwrap();
        assert_eq!(result, "doc.md");

        fs::remove_file(&alias_parent).unwrap();
        fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn project_relative_path_macos_var_alias() {
        let raw_tmp = std::env::temp_dir();
        let canonical_tmp = raw_tmp.canonicalize().unwrap();
        if raw_tmp == canonical_tmp {
            return;
        }

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir_name = format!("coflat-macos-alias-{unique}");

        let canonical_root = canonical_tmp.join(&dir_name);
        fs::create_dir_all(&canonical_root).unwrap();

        let file = canonical_root.join("notes.md");
        fs::write(&file, "").unwrap();

        let aliased_candidate = raw_tmp.join(&dir_name).join("notes.md");
        let result = project_relative_path(&canonical_root, &aliased_candidate).unwrap();
        assert_eq!(result, "notes.md");

        fs::remove_dir_all(&canonical_root).unwrap();
    }

    #[test]
    fn project_relative_path_nonexistent_file() {
        let root = create_temp_dir("path-nonexist");
        let candidate = root.join("new-file.md");

        let result = project_relative_path(&root, &candidate).unwrap();
        assert_eq!(result, "new-file.md");

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn project_relative_path_nonexistent_nested() {
        let root = create_temp_dir("path-nested");
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
    fn resolve_project_path_rejects_dotdot_escape() {
        let root = create_temp_dir("traversal-test");
        fs::create_dir_all(root.join("sub")).unwrap();

        let err = resolve_project_path(&root, "sub/../../etc/passwd")
            .expect_err("should reject traversal");
        assert!(err.contains("escapes project root"), "got: {err}");

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn resolve_project_path_allows_dotdot_within_root() {
        let root = create_temp_dir("dotdot-within");
        fs::create_dir_all(root.join("a/b")).unwrap();
        let file = root.join("a/target.md");
        fs::write(&file, "").unwrap();

        let result = resolve_project_path(&root, "a/b/../target.md").unwrap();
        assert!(result.ends_with("target.md"));
        assert!(result.starts_with(&root));

        fs::remove_dir_all(&root).unwrap();
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

    #[test]
    fn resolve_project_path_rejects_dangling_symlink_leaf() {
        let root = create_temp_dir("dangling-leaf-root");
        let outside = create_temp_dir("dangling-leaf-outside");
        let dangling_target = outside.join("escaped.md");
        let link = root.join("escape.md");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&dangling_target, &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&dangling_target, &link).unwrap();

        let err = resolve_project_path(&root, "escape.md")
            .expect_err("dangling symlink leaf should be rejected");
        assert!(
            err.contains("Cannot resolve path 'escape.md'"),
            "got: {err}"
        );

        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn resolve_project_path_rejects_dangling_symlink_ancestor() {
        let root = create_temp_dir("dangling-ancestor-root");
        let outside = create_temp_dir("dangling-ancestor-outside");
        let dangling_target = outside.join("missing-dir");
        let link = root.join("escape");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&dangling_target, &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&dangling_target, &link).unwrap();

        let err = resolve_project_path(&root, "escape/note.md")
            .expect_err("dangling symlink ancestor should be rejected");
        assert!(
            err.contains("Cannot resolve path 'escape/note.md'"),
            "got: {err}"
        );

        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }
}
