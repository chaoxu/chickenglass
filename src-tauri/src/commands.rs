use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
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

/// Check whether Pandoc is installed and return its version string.
#[tauri::command]
pub fn check_pandoc() -> Result<String, String> {
    let output = Command::new("pandoc")
        .arg("--version")
        .output()
        .map_err(|e| format!("Failed to run pandoc: {}", e))?;

    if !output.status.success() {
        return Err("pandoc --version returned a non-zero exit code".to_string());
    }

    let version = String::from_utf8_lossy(&output.stdout);
    // Return the first line (e.g. "pandoc 3.1.9")
    Ok(version.lines().next().unwrap_or("pandoc (unknown version)").to_string())
}

/// Export a markdown document to PDF or LaTeX via Pandoc.
///
/// Content is passed via stdin to Pandoc. For PDF output, xelatex is used
/// as the PDF engine to support Unicode and custom fonts.
#[tauri::command]
pub fn export_document(
    content: String,
    format: String,
    output_path: String,
) -> Result<String, String> {
    let output_path = PathBuf::from(&output_path);

    // Ensure the parent directory exists
    if let Some(parent) = output_path.parent() {
        if !parent.exists() {
            return Err(format!(
                "Output directory does not exist: {}",
                parent.display()
            ));
        }
    }

    let mut args = vec![
        "-f".to_string(),
        "markdown".to_string(),
        "-o".to_string(),
        output_path.to_string_lossy().to_string(),
    ];

    match format.as_str() {
        "pdf" => {
            args.push("--pdf-engine=xelatex".to_string());
        }
        "latex" => {
            // No extra flags needed for LaTeX output
        }
        _ => {
            return Err(format!("Unsupported export format: {}", format));
        }
    }

    let mut child = Command::new("pandoc")
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start pandoc: {}", e))?;

    // Write content to stdin
    if let Some(ref mut stdin) = child.stdin {
        stdin
            .write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write to pandoc stdin: {}", e))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for pandoc: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Pandoc failed: {}", stderr));
    }

    Ok(output_path.to_string_lossy().to_string())
}
