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
        .map(|entry| entry.path.clone())
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
    ensure_within_root(root, &full, relative)?;
    Ok(full)
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

pub fn project_relative_path(root: &Path, candidate: &Path) -> Result<String, String> {
    let relative = candidate
        .strip_prefix(root)
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
