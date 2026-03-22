use std::path::{Path, PathBuf};

use tauri::State;

use super::state::ProjectRoot;

pub fn current_project_root(root: &State<'_, ProjectRoot>) -> Result<PathBuf, String> {
    let lock = root.0.lock().map_err(|e| e.to_string())?;
    lock.clone().ok_or("No project folder open".to_string())
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
