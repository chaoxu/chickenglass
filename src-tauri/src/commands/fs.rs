use std::path::PathBuf;

use tauri::{State, WebviewWindow, command};

use super::state::{PerfState, ProjectRoot};
use super::context::{run_command, CommandSpec, WindowCommandContext};
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
        let paths = ProjectPathResolver::new(project_root)?;
        let full = paths.resolve_project_path(&path)?;
        filesystem::create_text_file(&full, &path, content.as_deref())
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
        |project_root| {
            let paths = ProjectPathResolver::new(project_root)?;
            let full = paths.resolve_project_path(&path)?;
            filesystem::create_directory(&full, &path)
        },
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
            let old_resolved = paths.resolve_existing_path(&old_path)?;
            let new_full = paths.resolve_project_path(&new_path)?;
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
        let resolved = paths.resolve_existing_path(&path)?;
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
        |project_root| {
            let paths = ProjectPathResolver::new(project_root)?;
            let full = paths.resolve_project_path(&path)?;
            filesystem::write_binary_file(&full, &path, &data_base64)
        },
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
