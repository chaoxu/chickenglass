use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};

pub const FRONTEND_PATH_TRANSPORT_POLICY: &str =
    "Coflat native paths must be valid UTF-8 before they can cross the Tauri boundary";

pub struct ProjectPathResolver {
    canonical_root: PathBuf,
}

impl ProjectPathResolver {
    pub fn new(root: &Path) -> Result<Self, String> {
        let canonical_root = root
            .canonicalize()
            .map_err(|e| format!("Cannot resolve project root '{}': {}", root.display(), e))?;
        Ok(Self { canonical_root })
    }

    pub fn resolve_project_path(&self, relative: &str) -> Result<PathBuf, String> {
        reject_unsafe_relative_components(relative, true)?;
        let full = self.canonical_root.join(relative);
        // Resolve `..` and symlink aliases before checking project-root containment.
        let canonical = canonicalize_maybe_missing(&full)
            .map_err(|e| format!("Cannot resolve path '{}': {}", relative, e))?;
        if !canonical.starts_with(&self.canonical_root) {
            return Err(format!("Path '{}' escapes project root", relative));
        }
        Ok(canonical)
    }

    pub fn resolve_existing_path(&self, relative: &str) -> Result<PathBuf, String> {
        let full = self.resolve_project_path(relative)?;
        if !full.exists() {
            return Err(format!(
                "Cannot resolve path '{}': No such file or directory",
                relative
            ));
        }
        Ok(full)
    }

    pub fn resolve_project_entry_path(&self, relative: &str) -> Result<PathBuf, String> {
        reject_unsafe_relative_components(relative, false)?;
        let full = self.canonical_root.join(relative);
        let entry = canonicalize_parent_maybe_missing(&full)
            .map_err(|e| format!("Cannot resolve path '{}': {}", relative, e))?;
        if !entry.starts_with(&self.canonical_root) {
            return Err(format!("Path '{}' escapes project root", relative));
        }
        Ok(entry)
    }

    pub fn resolve_existing_entry_path(&self, relative: &str) -> Result<PathBuf, String> {
        let full = self.resolve_project_entry_path(relative)?;
        match std::fs::symlink_metadata(&full) {
            Ok(_) => Ok(full),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(format!(
                "Cannot resolve path '{}': No such file or directory",
                relative
            )),
            Err(error) => Err(format!("Cannot resolve path '{}': {}", relative, error)),
        }
    }

    pub fn project_relative_path(&self, candidate: &Path) -> Result<String, String> {
        let canonical_candidate = canonicalize_maybe_missing(candidate)
            .map_err(|_| format!("Path '{}' escapes project root", candidate.display()))?;

        let relative = canonical_candidate
            .strip_prefix(&self.canonical_root)
            .map_err(|_| format!("Path '{}' escapes project root", candidate.display()))?;

        path_to_frontend_string(relative, "Project-relative path")
    }
}

fn reject_unsafe_relative_components(relative: &str, allow_empty: bool) -> Result<(), String> {
    if relative.is_empty() {
        return if allow_empty {
            Ok(())
        } else {
            Err("Path must end in a normal file name".to_string())
        };
    }

    let path = Path::new(relative);
    if path.is_absolute() {
        return Err("Path must be relative to project root".to_string());
    }

    for component in path.components() {
        match component {
            Component::Normal(_) => {}
            Component::CurDir | Component::ParentDir => {
                return Err("Path cannot contain . or .. components".to_string());
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Path must be relative to project root".to_string());
            }
        }
    }

    #[cfg(windows)]
    let separators: &[char] = &['/', '\\'];
    #[cfg(not(windows))]
    let separators: &[char] = &['/'];

    let mut has_normal_segment = false;
    for segment in relative.split(separators) {
        if segment.is_empty() {
            continue;
        }
        has_normal_segment = true;
        if segment == "." || segment == ".." {
            return Err("Path cannot contain . or .. components".to_string());
        }
    }

    if !allow_empty && !has_normal_segment {
        return Err("Path must end in a normal file name".to_string());
    }
    Ok(())
}

fn canonicalize_parent_maybe_missing(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path '{}' has no parent", path.display()))?;
    let name = match path.components().next_back() {
        Some(Component::Normal(name)) => name.to_owned(),
        _ => {
            return Err(format!(
                "Path '{}' must end in a normal file name",
                path.display()
            ));
        }
    };
    Ok(canonicalize_maybe_missing(parent)?.join(name))
}

pub fn file_name_to_frontend_string(name: &OsStr, label: &str) -> Result<String, String> {
    name.to_str()
        .map(str::to_owned)
        .ok_or_else(|| unsupported_frontend_path_error(label))
}

pub fn path_to_frontend_string(path: &Path, label: &str) -> Result<String, String> {
    let path = path
        .to_str()
        .ok_or_else(|| unsupported_frontend_path_error(label))?;
    if std::path::MAIN_SEPARATOR == '\\' {
        Ok(path.replace('\\', "/"))
    } else {
        Ok(path.to_string())
    }
}

fn unsupported_frontend_path_error(label: &str) -> String {
    format!("{label} is not valid UTF-8. {FRONTEND_PATH_TRANSPORT_POLICY}.")
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
        let resolver = ProjectPathResolver::new(&root).unwrap();

        let result = resolver.project_relative_path(&file).unwrap();
        assert_eq!(result, "sub/file.md");

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn project_relative_path_with_symlink_alias() {
        let root = create_temp_dir("symlink-test");
        let file = root.join("doc.md");
        fs::write(&file, "").unwrap();
        let resolver = ProjectPathResolver::new(&root).unwrap();

        let alias_parent = root.parent().unwrap().join("coflat-symlink-alias");
        let _ = fs::remove_file(&alias_parent);
        #[cfg(unix)]
        std::os::unix::fs::symlink(&root, &alias_parent).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&root, &alias_parent).unwrap();

        let aliased_candidate = alias_parent.join("doc.md");
        let result = resolver.project_relative_path(&aliased_candidate).unwrap();
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
        let resolver = ProjectPathResolver::new(&canonical_root).unwrap();

        let aliased_candidate = raw_tmp.join(&dir_name).join("notes.md");
        let result = resolver.project_relative_path(&aliased_candidate).unwrap();
        assert_eq!(result, "notes.md");

        fs::remove_dir_all(&canonical_root).unwrap();
    }

    #[test]
    fn project_relative_path_nonexistent_file() {
        let root = create_temp_dir("path-nonexist");
        let candidate = root.join("new-file.md");
        let resolver = ProjectPathResolver::new(&root).unwrap();

        let result = resolver.project_relative_path(&candidate).unwrap();
        assert_eq!(result, "new-file.md");

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn project_relative_path_nonexistent_nested() {
        let root = create_temp_dir("path-nested");
        let candidate = root.join("new-dir/deep/file.md");
        let resolver = ProjectPathResolver::new(&root).unwrap();

        let result = resolver.project_relative_path(&candidate).unwrap();
        assert_eq!(result, "new-dir/deep/file.md");

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn project_relative_path_rejects_outside_path() {
        let root = create_temp_dir("path-outside-root");
        let outside = create_temp_dir("path-outside-other");
        let candidate = outside.join("file.md");
        fs::write(&candidate, "").unwrap();
        let resolver = ProjectPathResolver::new(&root).unwrap();

        let err = resolver
            .project_relative_path(&candidate)
            .expect_err("should reject");
        assert!(err.contains("escapes project root"));

        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn project_relative_path_rejects_non_utf8_paths() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        let root = create_temp_dir("path-nonutf8");
        let candidate = root.join(PathBuf::from(OsString::from_vec(vec![
            b'b', b'a', b'd', 0x80,
        ])));
        let resolver = ProjectPathResolver::new(&root).unwrap();

        let err = resolver
            .project_relative_path(&candidate)
            .expect_err("non-utf8 paths should be rejected");
        assert!(err.contains("not valid UTF-8"), "got: {}", err);

        fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn path_to_frontend_string_preserves_literal_backslashes_on_unix() {
        assert_eq!(
            path_to_frontend_string(Path::new(r"docs\literal-backslash.md"), "Relative path")
                .unwrap(),
            r"docs\literal-backslash.md",
        );
    }

    #[cfg(unix)]
    #[test]
    fn file_name_to_frontend_string_rejects_non_utf8_names() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        let err = file_name_to_frontend_string(
            &OsString::from_vec(vec![b'b', b'a', b'd', 0x80]),
            "Directory entry name",
        )
        .expect_err("non-utf8 file names should fail");
        assert!(err.contains("Directory entry name is not valid UTF-8"));
        assert!(err.contains(FRONTEND_PATH_TRANSPORT_POLICY));
    }

    #[test]
    fn resolve_project_path_rejects_dotdot_escape() {
        let root = create_temp_dir("traversal-test");
        fs::create_dir_all(root.join("sub")).unwrap();
        let resolver = ProjectPathResolver::new(&root).unwrap();

        let err = resolver
            .resolve_project_path("sub/../../etc/passwd")
            .expect_err("should reject traversal");
        assert!(
            err.contains("cannot contain . or .. components"),
            "got: {}",
            err
        );

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn resolve_project_path_rejects_dotdot_within_root() {
        let root = create_temp_dir("dotdot-within");
        fs::create_dir_all(root.join("a/b")).unwrap();
        let file = root.join("a/target.md");
        fs::write(&file, "").unwrap();
        let resolver = ProjectPathResolver::new(&root).unwrap();

        let err = resolver
            .resolve_project_path("a/b/../target.md")
            .expect_err("frontend paths must not contain dotdot segments");
        assert!(
            err.contains("cannot contain . or .. components"),
            "got: {}",
            err
        );

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn resolve_project_path_rejects_dot_segments() {
        let root = create_temp_dir("dot-segments");
        let resolver = ProjectPathResolver::new(&root).unwrap();

        for relative in ["./note.md", "docs/./note.md", "docs/."] {
            let err = resolver
                .resolve_project_path(relative)
                .expect_err("frontend paths must not contain dot segments");
            assert!(
                err.contains("cannot contain . or .. components"),
                "relative={relative}, got: {err}",
            );
        }

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn resolve_project_path_rejects_dotdot_after_missing_ancestor() {
        let root = create_temp_dir("missing-ancestor-dotdot");
        let resolver = ProjectPathResolver::new(&root).unwrap();

        let err = resolver
            .resolve_project_path("a/../../escaped.md")
            .expect_err("dotdot after a missing ancestor must be rejected");
        assert!(
            err.contains("cannot contain . or .. components"),
            "got: {}",
            err
        );

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
        let resolver = ProjectPathResolver::new(&root).unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(&dangling_target, &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&dangling_target, &link).unwrap();

        let err = resolver
            .resolve_project_path("escape.md")
            .expect_err("dangling symlink leaf should be rejected");
        assert!(
            err.contains("Cannot resolve path 'escape.md'"),
            "got: {}",
            err
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
        let resolver = ProjectPathResolver::new(&root).unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(&dangling_target, &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&dangling_target, &link).unwrap();

        let err = resolver
            .resolve_project_path("escape/note.md")
            .expect_err("dangling symlink ancestor should be rejected");
        assert!(
            err.contains("Cannot resolve path 'escape/note.md'"),
            "got: {}",
            err
        );

        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn resolve_existing_entry_path_preserves_symlink_leaf() {
        let root = create_temp_dir("entry-symlink-root");
        let outside = create_temp_dir("entry-symlink-outside");
        let target = outside.join("target.md");
        let link = root.join("link.md");
        fs::write(&target, "target").unwrap();
        let resolver = ProjectPathResolver::new(&root).unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&target, &link).unwrap();

        let result = resolver.resolve_existing_entry_path("link.md").unwrap();
        assert_eq!(result, link);

        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn resolve_existing_entry_path_rejects_dot_leaf_components() {
        let root = create_temp_dir("entry-dot-root");
        fs::create_dir(root.join("docs")).unwrap();
        let resolver = ProjectPathResolver::new(&root).unwrap();

        for relative in ["docs/.", "docs/..", "docs/../.."] {
            let err = resolver
                .resolve_existing_entry_path(relative)
                .expect_err("dot leaf components should be rejected");
            assert!(
                err.contains("must end in a normal file name")
                    || err.contains("cannot contain . or .. components"),
                "relative={relative}, got: {err}",
            );
        }

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn resolve_project_entry_path_rejects_dotdot_after_missing_ancestor() {
        let root = create_temp_dir("entry-missing-ancestor-dotdot");
        let resolver = ProjectPathResolver::new(&root).unwrap();

        let err = resolver
            .resolve_project_entry_path("a/../../escaped.md")
            .expect_err("dotdot after a missing ancestor must be rejected");
        assert!(
            err.contains("cannot contain . or .. components"),
            "got: {}",
            err
        );

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn resolve_project_entry_path_rejects_symlink_ancestor_escape() {
        let root = create_temp_dir("entry-ancestor-root");
        let outside = create_temp_dir("entry-ancestor-outside");
        let link = root.join("outside");
        let resolver = ProjectPathResolver::new(&root).unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&outside, &link).unwrap();

        let err = resolver
            .resolve_project_entry_path("outside/file.md")
            .expect_err("symlink ancestor should be rejected");
        assert!(err.contains("escapes project root"), "got: {}", err);

        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }
}
