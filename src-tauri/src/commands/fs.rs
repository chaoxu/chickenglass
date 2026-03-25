use std::fs;
use std::path::Path;

use base64::Engine;
use serde::Serialize;
use tauri::{State, WebviewWindow, command};

use super::perf::measure_command;
use super::path::{current_project_root, resolve_existing_path, resolve_project_path};
use super::state::{PerfState, ProjectRoot};

/// A file or directory entry for the sidebar tree.
#[derive(Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileEntry>>,
}

/// Open a folder dialog and set it as the project root.
#[command]
pub fn open_folder(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<(), String> {
    measure_command(&perf, "tauri.open_folder", "tauri.fs.open_folder", "tauri", Some(&path), || {
        let path = std::path::PathBuf::from(&path);
        if !path.is_dir() {
            return Err(format!("Not a directory: {}", path.display()));
        }
        let canonical = path
            .canonicalize()
            .map_err(|e| format!("Cannot resolve path: {}", e))?;
        let mut lock = root.0.lock().map_err(|e| e.to_string())?;
        lock.insert(window.label().to_string(), canonical);
        Ok(())
    })
}

/// Read a file's content as UTF-8 text.
#[command]
pub fn read_file(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<String, String> {
    measure_command(&perf, "tauri.read_file", "tauri.fs.read_file", "tauri", Some(&path), || {
        let project_root = current_project_root(&root, &window)?;
        let resolved = resolve_existing_path(&project_root, &path)?;
        fs::read_to_string(&resolved).map_err(|e| format!("Failed to read '{}': {}", path, e))
    })
}

/// Write content to a file (must already exist).
#[command]
pub fn write_file(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
    content: String,
) -> Result<(), String> {
    measure_command(&perf, "tauri.write_file", "tauri.fs.write_file", "tauri", Some(&path), || {
        let project_root = current_project_root(&root, &window)?;
        let resolved = resolve_existing_path(&project_root, &path)?;
        if !resolved.exists() {
            return Err(format!("File not found: {}", path));
        }
        fs::write(&resolved, &content).map_err(|e| format!("Failed to write '{}': {}", path, e))
    })
}

/// Create a new file with optional content.
#[command]
pub fn create_file(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
    content: Option<String>,
) -> Result<(), String> {
    measure_command(&perf, "tauri.create_file", "tauri.fs.create_file", "tauri", Some(&path), || {
        let project_root = current_project_root(&root, &window)?;
        let full = resolve_project_path(&project_root, &path)?;

        if full.exists() {
            return Err(format!("File already exists: {}", path));
        }
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
        }
        fs::write(&full, content.clone().unwrap_or_default())
            .map_err(|e| format!("Failed to create '{}': {}", path, e))
    })
}

/// Create a new directory (and any missing ancestors) within the project root.
#[command]
pub fn create_directory(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<(), String> {
    measure_command(
        &perf,
        "tauri.create_directory",
        "tauri.fs.create_directory",
        "tauri",
        Some(&path),
        || {
            let project_root = current_project_root(&root, &window)?;
            let full = resolve_project_path(&project_root, &path)?;

            if full.exists() {
                return Err(format!("Directory already exists: {}", path));
            }
            fs::create_dir_all(&full)
                .map_err(|e| format!("Failed to create directory '{}': {}", path, e))
        },
    )
}

/// Check whether a file exists.
#[command]
pub fn file_exists(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<bool, String> {
    measure_command(&perf, "tauri.file_exists", "tauri.fs.file_exists", "tauri", Some(&path), || {
        let project_root = current_project_root(&root, &window)?;
        let full = resolve_project_path(&project_root, &path)?;
        Ok(full.exists())
    })
}

/// Rename (move) a file within the project root.
#[command]
pub fn rename_file(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    measure_command(
        &perf,
        "tauri.rename_file",
        "tauri.fs.rename_file",
        "tauri",
        Some(&old_path),
        || {
            let project_root = current_project_root(&root, &window)?;
            let old_resolved = resolve_existing_path(&project_root, &old_path)?;
            let new_full = resolve_project_path(&project_root, &new_path)?;

            if new_full.exists() {
                return Err(format!("File already exists: {}", new_path));
            }
            fs::rename(&old_resolved, &new_full)
                .map_err(|e| format!("Failed to rename '{}' to '{}': {}", old_path, new_path, e))
        },
    )
}

/// List the file tree starting from the project root.
#[command]
pub fn list_tree(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
) -> Result<FileEntry, String> {
    measure_command(&perf, "tauri.list_tree", "tauri.fs.list_tree", "tauri", None, || {
        let project_root = current_project_root(&root, &window)?;
        let name = project_root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "project".to_string());
        build_tree(&project_root, &name, "")
    })
}

/// Delete a file within the project root.
#[command]
pub fn delete_file(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<(), String> {
    measure_command(&perf, "tauri.delete_file", "tauri.fs.delete_file", "tauri", Some(&path), || {
        let project_root = current_project_root(&root, &window)?;
        let resolved = resolve_existing_path(&project_root, &path)?;
        if resolved.is_dir() {
            fs::remove_dir_all(&resolved)
                .map_err(|e| format!("Failed to delete directory '{}': {}", path, e))
        } else {
            fs::remove_file(&resolved).map_err(|e| format!("Failed to delete '{}': {}", path, e))
        }
    })
}

/// Write binary data (received as base64) to a file within the project root.
#[command]
pub fn write_file_binary(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
    data_base64: String,
) -> Result<(), String> {
    measure_command(
        &perf,
        "tauri.write_file_binary",
        "tauri.fs.write_file_binary",
        "tauri",
        Some(&path),
        || {
            let project_root = current_project_root(&root, &window)?;
            let full = resolve_project_path(&project_root, &path)?;

            if let Some(parent) = full.parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create directories: {}", e))?;
                }
            }

            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&data_base64)
                .map_err(|e| format!("Invalid base64 data: {}", e))?;

            fs::write(&full, &bytes)
                .map_err(|e| format!("Failed to write binary file '{}': {}", path, e))
        },
    )
}

/// Read a file's content as raw bytes and return as base64-encoded string.
#[command]
pub fn read_file_binary(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<String, String> {
    measure_command(
        &perf,
        "tauri.read_file_binary",
        "tauri.fs.read_file_binary",
        "tauri",
        Some(&path),
        || {
            let project_root = current_project_root(&root, &window)?;
            let resolved = resolve_existing_path(&project_root, &path)?;
            let bytes = fs::read(&resolved)
                .map_err(|e| format!("Failed to read binary file '{}': {}", path, e))?;
            Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
        },
    )
}

/// Recursively build a FileEntry tree from a directory.
fn build_tree(dir: &Path, name: &str, relative_path: &str) -> Result<FileEntry, String> {
    let mut children = Vec::new();
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory '{}': {}", dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();

        if file_name.starts_with('.') || file_name == "node_modules" || file_name == "target" {
            continue;
        }

        let child_path = if relative_path.is_empty() {
            file_name.clone()
        } else {
            format!("{}/{}", relative_path, file_name)
        };

        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            children.push(build_tree(&entry.path(), &file_name, &child_path)?);
        } else {
            children.push(FileEntry {
                name: file_name,
                path: child_path,
                is_directory: false,
                children: None,
            });
        }
    }

    children.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            if a.is_directory {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        } else {
            a.name.cmp(&b.name)
        }
    });

    Ok(FileEntry {
        name: name.to_string(),
        path: relative_path.to_string(),
        is_directory: true,
        children: Some(children),
    })
}
