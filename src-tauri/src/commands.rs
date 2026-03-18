use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

/// Shared state holding the currently opened project directory.
pub struct ProjectRoot(pub Mutex<Option<PathBuf>>);

/// A file or directory entry for the sidebar tree.
#[derive(Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileEntry>>,
}

/// Resolve a relative path against the project root, rejecting traversal.
fn resolve_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let joined = root.join(relative);
    let resolved = joined
        .canonicalize()
        .map_err(|e| format!("Cannot resolve path '{}': {}", relative, e))?;
    if !resolved.starts_with(root) {
        return Err(format!("Path '{}' escapes project root", relative));
    }
    Ok(resolved)
}

/// Open a folder dialog and set it as the project root.
#[tauri::command]
pub fn open_folder(
    root: State<'_, ProjectRoot>,
    path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", path.display()));
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Cannot resolve path: {}", e))?;
    let mut lock = root.0.lock().map_err(|e| e.to_string())?;
    *lock = Some(canonical);
    Ok(())
}

/// Read a file's content as UTF-8 text.
#[tauri::command]
pub fn read_file(
    root: State<'_, ProjectRoot>,
    path: String,
) -> Result<String, String> {
    let lock = root.0.lock().map_err(|e| e.to_string())?;
    let project_root = lock.as_ref().ok_or("No project folder open")?;
    let resolved = resolve_path(project_root, &path)?;
    fs::read_to_string(&resolved)
        .map_err(|e| format!("Failed to read '{}': {}", path, e))
}

/// Write content to a file (must already exist).
#[tauri::command]
pub fn write_file(
    root: State<'_, ProjectRoot>,
    path: String,
    content: String,
) -> Result<(), String> {
    let lock = root.0.lock().map_err(|e| e.to_string())?;
    let project_root = lock.as_ref().ok_or("No project folder open")?;
    let resolved = resolve_path(project_root, &path)?;
    if !resolved.exists() {
        return Err(format!("File not found: {}", path));
    }
    fs::write(&resolved, &content)
        .map_err(|e| format!("Failed to write '{}': {}", path, e))
}

/// Create a new file with optional content.
#[tauri::command]
pub fn create_file(
    root: State<'_, ProjectRoot>,
    path: String,
    content: Option<String>,
) -> Result<(), String> {
    let lock = root.0.lock().map_err(|e| e.to_string())?;
    let project_root = lock.as_ref().ok_or("No project folder open")?;
    let full = project_root.join(&path);
    // Security: ensure the resolved path stays within the root
    if let Ok(canonical_parent) = full.parent().unwrap_or(project_root).canonicalize() {
        if !canonical_parent.starts_with(project_root) {
            return Err(format!("Path '{}' escapes project root", path));
        }
    }
    if full.exists() {
        return Err(format!("File already exists: {}", path));
    }
    // Create parent directories if needed
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {}", e))?;
    }
    fs::write(&full, content.unwrap_or_default())
        .map_err(|e| format!("Failed to create '{}': {}", path, e))
}

/// Check whether a file exists.
#[tauri::command]
pub fn file_exists(
    root: State<'_, ProjectRoot>,
    path: String,
) -> Result<bool, String> {
    let lock = root.0.lock().map_err(|e| e.to_string())?;
    let project_root = lock.as_ref().ok_or("No project folder open")?;
    let full = project_root.join(&path);
    Ok(full.exists())
}

/// List the file tree starting from the project root.
#[tauri::command]
pub fn list_tree(
    root: State<'_, ProjectRoot>,
) -> Result<FileEntry, String> {
    let lock = root.0.lock().map_err(|e| e.to_string())?;
    let project_root = lock.as_ref().ok_or("No project folder open")?;
    let name = project_root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".to_string());
    build_tree(project_root, &name, "")
}

/// Recursively build a FileEntry tree from a directory.
fn build_tree(dir: &Path, name: &str, relative_path: &str) -> Result<FileEntry, String> {
    let mut children = Vec::new();
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory '{}': {}", dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files and common non-content directories
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
            let child = build_tree(&entry.path(), &file_name, &child_path)?;
            children.push(child);
        } else {
            children.push(FileEntry {
                name: file_name,
                path: child_path,
                is_directory: false,
                children: None,
            });
        }
    }

    // Sort: directories first, then alphabetical
    children.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            if a.is_directory { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater }
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
