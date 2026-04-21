use std::path::{Path, PathBuf};

use tauri::{State, WebviewWindow, command};

use super::context::{CommandSpec, WindowCommandContext, run_command};
use super::state::{PerfState, ProjectRoot};
pub use crate::services::filesystem::FileEntry;
use crate::services::{filesystem, path::ProjectPathResolver};

const OPEN_FOLDER: CommandSpec =
    CommandSpec::new("tauri.open_folder", "tauri.fs.open_folder", "tauri");
const READ_FILE: CommandSpec = CommandSpec::new("tauri.read_file", "tauri.fs.read_file", "tauri");
const WRITE_FILE: CommandSpec =
    CommandSpec::new("tauri.write_file", "tauri.fs.write_file", "tauri");
const CREATE_FILE: CommandSpec =
    CommandSpec::new("tauri.create_file", "tauri.fs.create_file", "tauri");
const CREATE_DIRECTORY: CommandSpec = CommandSpec::new(
    "tauri.create_directory",
    "tauri.fs.create_directory",
    "tauri",
);
const FILE_EXISTS: CommandSpec =
    CommandSpec::new("tauri.file_exists", "tauri.fs.file_exists", "tauri");
const RENAME_FILE: CommandSpec =
    CommandSpec::new("tauri.rename_file", "tauri.fs.rename_file", "tauri");
const LIST_TREE: CommandSpec = CommandSpec::new("tauri.list_tree", "tauri.fs.list_tree", "tauri");
const DELETE_FILE: CommandSpec =
    CommandSpec::new("tauri.delete_file", "tauri.fs.delete_file", "tauri");
const WRITE_FILE_BINARY: CommandSpec = CommandSpec::new(
    "tauri.write_file_binary",
    "tauri.fs.write_file_binary",
    "tauri",
);
const READ_FILE_BINARY: CommandSpec = CommandSpec::new(
    "tauri.read_file_binary",
    "tauri.fs.read_file_binary",
    "tauri",
);
const LIST_CHILDREN: CommandSpec =
    CommandSpec::new("tauri.list_children", "tauri.fs.list_children", "tauri");

#[command]
pub fn open_folder(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
    generation: u64,
) -> Result<bool, String> {
    run_command(&perf, OPEN_FOLDER, Some(&path), || {
        let path = PathBuf::from(&path);
        if !path.is_dir() {
            return Err(format!("Not a directory: {}", path.display()));
        }
        let canonical = map_err_str!(path.canonicalize(), "Cannot resolve path: {}")?;
        let mut lock = root.0.lock().map_err(|e| e.to_string())?;
        Ok(filesystem::install_project_root(
            &mut lock,
            window.label(),
            canonical,
            generation,
        ))
    })
}

#[command]
pub fn read_file(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<String, String> {
    WindowCommandContext::new(&window, &root, &perf).run(READ_FILE, Some(&path), |project_root| {
        let paths = ProjectPathResolver::new(project_root)?;
        let resolved = paths.resolve_existing_path(&path)?;
        filesystem::read_text_file(&resolved, &path)
    })
}

#[command]
pub fn write_file(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
    content: String,
) -> Result<(), String> {
    WindowCommandContext::new(&window, &root, &perf).run(WRITE_FILE, Some(&path), |project_root| {
        let paths = ProjectPathResolver::new(project_root)?;
        let resolved = paths.resolve_existing_path(&path)?;
        filesystem::write_text_file(&resolved, &path, &content)
    })
}

#[command]
pub fn create_file(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
    content: Option<String>,
) -> Result<(), String> {
    WindowCommandContext::new(&window, &root, &perf).run(CREATE_FILE, Some(&path), |project_root| {
        create_file_at_project_root(project_root, &path, content.as_deref())
    })
}

#[command]
pub fn create_directory(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<(), String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        CREATE_DIRECTORY,
        Some(&path),
        |project_root| create_directory_at_project_root(project_root, &path),
    )
}

#[command]
pub fn file_exists(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<bool, String> {
    WindowCommandContext::new(&window, &root, &perf).run(FILE_EXISTS, Some(&path), |project_root| {
        let paths = ProjectPathResolver::new(project_root)?;
        let full = paths.resolve_project_path(&path)?;
        Ok(full.exists())
    })
}

#[command]
pub fn rename_file(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        RENAME_FILE,
        Some(&old_path),
        |project_root| {
            let paths = ProjectPathResolver::new(project_root)?;
            let old_resolved = paths.resolve_existing_entry_path(&old_path)?;
            let new_full = paths.resolve_project_entry_path(&new_path)?;
            filesystem::rename_path(&old_resolved, &old_path, &new_full, &new_path)
        },
    )
}

#[command]
pub fn list_tree(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
) -> Result<FileEntry, String> {
    WindowCommandContext::new(&window, &root, &perf).run(LIST_TREE, None, filesystem::list_tree)
}

#[command]
pub fn delete_file(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<(), String> {
    WindowCommandContext::new(&window, &root, &perf).run(DELETE_FILE, Some(&path), |project_root| {
        let paths = ProjectPathResolver::new(project_root)?;
        let resolved = paths.resolve_existing_entry_path(&path)?;
        filesystem::delete_path(&resolved, &path)
    })
}

#[command]
pub fn write_file_binary(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
    data_base64: String,
) -> Result<(), String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        WRITE_FILE_BINARY,
        Some(&path),
        |project_root| write_binary_file_at_project_root(project_root, &path, &data_base64),
    )
}

#[command]
pub fn read_file_binary(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<String, String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        READ_FILE_BINARY,
        Some(&path),
        |project_root| {
            let paths = ProjectPathResolver::new(project_root)?;
            let resolved = paths.resolve_existing_path(&path)?;
            filesystem::read_binary_file(&resolved, &path)
        },
    )
}

#[command]
pub fn list_children(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        LIST_CHILDREN,
        Some(&path),
        |project_root| {
            let paths = ProjectPathResolver::new(project_root)?;
            let dir = if path.is_empty() {
                project_root.to_path_buf()
            } else {
                paths.resolve_existing_path(&path)?
            };
            filesystem::list_children(&dir, &path)
        },
    )
}

fn create_file_at_project_root(
    project_root: &Path,
    path: &str,
    content: Option<&str>,
) -> Result<(), String> {
    let paths = ProjectPathResolver::new(project_root)?;
    let full = paths.resolve_project_entry_path(path)?;
    filesystem::create_text_file(&full, path, content)
}

fn create_directory_at_project_root(project_root: &Path, path: &str) -> Result<(), String> {
    let paths = ProjectPathResolver::new(project_root)?;
    let full = paths.resolve_project_entry_path(path)?;
    filesystem::create_directory(&full, path)
}

fn write_binary_file_at_project_root(
    project_root: &Path,
    path: &str,
    data_base64: &str,
) -> Result<(), String> {
    let paths = ProjectPathResolver::new(project_root)?;
    let full = paths.resolve_project_path(path)?;
    filesystem::write_binary_file(&full, path, data_base64)
}

#[cfg(test)]
mod tests {
    use super::{
        create_directory_at_project_root, create_file_at_project_root,
        write_binary_file_at_project_root,
    };
    use base64::Engine;
    use std::fs;
    use std::path::PathBuf;
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

    fn sibling_escape_path(root: &PathBuf, name: &str) -> (String, PathBuf) {
        let sibling_name = format!(
            "{}-{name}",
            root.file_name()
                .and_then(|value| value.to_str())
                .expect("temp root should be utf-8"),
        );
        let escaped = root
            .parent()
            .expect("temp root should have parent")
            .join(&sibling_name);
        (format!("a/../../{sibling_name}"), escaped)
    }

    #[test]
    fn create_file_rejects_missing_ancestor_traversal() {
        let root = create_temp_dir("cmd-create-file-traversal");
        let (relative, escaped) = sibling_escape_path(&root, "escaped.md");

        let err = create_file_at_project_root(&root, &relative, Some("escaped"))
            .expect_err("create_file should reject traversal before creating parents");

        assert!(
            err.contains("cannot contain . or .. components"),
            "got: {}",
            err
        );
        assert!(!escaped.exists(), "escaped file must not be created");
        assert!(
            !root.join("a").exists(),
            "resolver must reject before creating parents"
        );

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_file(&escaped);
    }

    #[test]
    fn create_directory_rejects_missing_ancestor_traversal() {
        let root = create_temp_dir("cmd-create-dir-traversal");
        let (relative, escaped) = sibling_escape_path(&root, "escaped-dir");

        let err = create_directory_at_project_root(&root, &relative)
            .expect_err("create_directory should reject traversal before creating parents");

        assert!(
            err.contains("cannot contain . or .. components"),
            "got: {}",
            err
        );
        assert!(!escaped.exists(), "escaped directory must not be created");
        assert!(
            !root.join("a").exists(),
            "resolver must reject before creating parents"
        );

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&escaped);
    }

    #[test]
    fn write_file_binary_rejects_missing_ancestor_traversal() {
        let root = create_temp_dir("cmd-write-binary-traversal");
        let (relative, escaped) = sibling_escape_path(&root, "escaped.bin");
        let encoded = base64::engine::general_purpose::STANDARD.encode([1, 2, 3]);

        let err = write_binary_file_at_project_root(&root, &relative, &encoded)
            .expect_err("write_file_binary should reject traversal before creating parents");

        assert!(
            err.contains("cannot contain . or .. components"),
            "got: {}",
            err
        );
        assert!(!escaped.exists(), "escaped binary file must not be created");
        assert!(
            !root.join("a").exists(),
            "resolver must reject before creating parents"
        );

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_file(&escaped);
    }
}
