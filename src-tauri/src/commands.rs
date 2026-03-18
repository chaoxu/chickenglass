use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// Shared state holding the currently opened project directory.
pub struct ProjectRoot(pub Mutex<Option<PathBuf>>);

/// Shared state holding the active file watcher (if any).
pub struct FileWatcherState(pub Mutex<Option<RecommendedWatcher>>);

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

/// Create a new directory (and any missing ancestors) within the project root.
#[tauri::command]
pub fn create_directory(
    root: State<'_, ProjectRoot>,
    path: String,
) -> Result<(), String> {
    let lock = root.0.lock().map_err(|e| e.to_string())?;
    let project_root = lock.as_ref().ok_or("No project folder open")?;
    let full = project_root.join(&path);
    // Security: ensure the path stays within the root (parent must already exist or be creatable)
    // We check the canonical form of the closest existing ancestor.
    let mut check = full.as_path();
    loop {
        if let Some(parent) = check.parent() {
            if parent.exists() {
                if let Ok(canonical) = parent.canonicalize() {
                    if !canonical.starts_with(project_root) {
                        return Err(format!("Path '{}' escapes project root", path));
                    }
                }
                break;
            }
            check = parent;
        } else {
            break;
        }
    }
    if full.exists() {
        return Err(format!("Directory already exists: {}", path));
    }
    fs::create_dir_all(&full)
        .map_err(|e| format!("Failed to create directory '{}': {}", path, e))
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

/// Rename (move) a file within the project root.
#[tauri::command]
pub fn rename_file(
    root: State<'_, ProjectRoot>,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let lock = root.0.lock().map_err(|e| e.to_string())?;
    let project_root = lock.as_ref().ok_or("No project folder open")?;
    let old_resolved = resolve_path(project_root, &old_path)?;
    // new_path's parent must exist; the new file itself must not exist
    let new_full = project_root.join(&new_path);
    // Security: ensure the new path stays within the root
    if let Some(parent) = new_full.parent() {
        if let Ok(canonical_parent) = parent.canonicalize() {
            if !canonical_parent.starts_with(project_root) {
                return Err(format!("Path '{}' escapes project root", new_path));
            }
        }
    }
    if new_full.exists() {
        return Err(format!("File already exists: {}", new_path));
    }
    fs::rename(&old_resolved, &new_full)
        .map_err(|e| format!("Failed to rename '{}' to '{}': {}", old_path, new_path, e))
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

/// Start watching a directory for file changes.
///
/// Emits `file-changed` events to the frontend with the relative file path
/// when files are created, modified, or removed. Events are debounced at 500ms.
#[tauri::command]
pub fn watch_directory(
    app: AppHandle,
    watcher_state: State<'_, FileWatcherState>,
    path: String,
) -> Result<(), String> {
    let watch_path = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("Cannot resolve path '{}': {}", path, e))?;

    if !watch_path.is_dir() {
        return Err(format!("Not a directory: {}", watch_path.display()));
    }

    // Stop any existing watcher first
    let mut lock = watcher_state.0.lock().map_err(|e| e.to_string())?;
    *lock = None;

    let root_for_closure = watch_path.clone();
    let debounce_ms = Duration::from_millis(500);
    let last_events: std::sync::Arc<Mutex<HashMap<PathBuf, Instant>>> =
        std::sync::Arc::new(Mutex::new(HashMap::new()));
    let last_events_clone = last_events.clone();

    let mut watcher = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            let event = match result {
                Ok(e) => e,
                Err(_) => return,
            };

            // Only report file-level changes (create, modify, remove)
            let dominated = matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
            );
            if !dominated {
                return;
            }

            for path in &event.paths {
                // Skip directories — only report file changes
                if path.is_dir() {
                    continue;
                }

                // Debounce: skip if we emitted for this path within the window
                {
                    let mut map = match last_events_clone.lock() {
                        Ok(m) => m,
                        Err(_) => continue,
                    };
                    let now = Instant::now();
                    if let Some(last) = map.get(path) {
                        if now.duration_since(*last) < debounce_ms {
                            continue;
                        }
                    }
                    map.insert(path.clone(), now);
                }

                // Compute relative path from the watched root
                let relative = match path.strip_prefix(&root_for_closure) {
                    Ok(r) => r.to_string_lossy().replace('\\', "/"),
                    Err(_) => continue,
                };

                // Skip hidden files and common non-content paths
                if relative.starts_with('.')
                    || relative.contains("/.")
                    || relative.starts_with("node_modules")
                    || relative.contains("/node_modules")
                    || relative.starts_with("target")
                    || relative.contains("/target")
                {
                    continue;
                }

                let _ = app.emit("file-changed", &relative);
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    watcher
        .watch(&watch_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {}", e))?;

    // Store watcher so it persists (dropping it stops watching)
    *lock = Some(watcher);

    Ok(())
}

/// Stop watching the current directory.
#[tauri::command]
pub fn unwatch_directory(
    watcher_state: State<'_, FileWatcherState>,
) -> Result<(), String> {
    let mut lock = watcher_state.0.lock().map_err(|e| e.to_string())?;
    *lock = None;
    Ok(())
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

/// Reveal a file or directory in the OS file explorer.
///
/// On macOS: uses `open -R <path>` to select the item in Finder.
/// On Windows: uses `explorer /select,<path>` (single combined argument).
/// On Linux: opens the parent directory with `xdg-open`.
#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to reveal in Finder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        // /select,<path> must be a single argument — no space between /select, and path
        Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| format!("Failed to reveal in Explorer: {}", e))?;
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // Linux: open the parent directory
        let p = PathBuf::from(&path);
        let parent = p.parent().unwrap_or(&p);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }

    Ok(())
}
