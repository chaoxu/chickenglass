use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, command};

use super::error::AppResult;
use super::state::{FileWatcherState, LastFocusedWindow, ProjectRoot};

fn ensure_debug_build() -> Result<(), String> {
    if cfg!(debug_assertions) {
        Ok(())
    } else {
        Err("Native debug commands are only available in debug builds".to_string())
    }
}

#[derive(Serialize)]
pub struct NativeWindowDebugInfo {
    pub label: String,
    pub focused: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDebugState {
    pub project_root: Option<String>,
    pub project_generation: Option<u64>,
    pub watcher_root: Option<String>,
    pub watcher_generation: Option<u64>,
    pub watcher_active: bool,
    pub last_focused_window: Option<String>,
}

#[command]
pub fn debug_list_windows(app: AppHandle) -> AppResult<Vec<NativeWindowDebugInfo>> {
    ensure_debug_build()?;

    let mut windows = app
        .webview_windows()
        .into_iter()
        .map(|(label, window)| NativeWindowDebugInfo {
            label,
            focused: window.is_focused().unwrap_or(false),
        })
        .collect::<Vec<_>>();
    windows.sort_by(|a, b| a.label.cmp(&b.label));
    Ok(windows)
}

#[command]
pub fn debug_get_native_state(
    window: WebviewWindow,
    project_root: State<'_, ProjectRoot>,
    watcher_state: State<'_, FileWatcherState>,
    last_focused_window: State<'_, LastFocusedWindow>,
) -> AppResult<NativeDebugState> {
    ensure_debug_build()?;

    let label = window.label();
    let (project_root, project_generation) = {
        let lock = project_root.0.lock().map_err(|e| e.to_string())?;
        let entry = lock.get(label);
        (
            entry.map(|value| value.path.display().to_string()),
            entry.map(|value| value.generation),
        )
    };
    let (watcher_root, watcher_generation, watcher_active) = {
        let lock = watcher_state.0.lock().map_err(|e| e.to_string())?;
        let entry = lock.get(label);
        (
            entry.map(|value| value.root.display().to_string()),
            entry.map(|value| value.generation),
            entry.and_then(|value| value.watcher.as_ref()).is_some(),
        )
    };
    let last_focused_window = last_focused_window
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    Ok(NativeDebugState {
        project_root,
        project_generation,
        watcher_root,
        watcher_generation,
        watcher_active,
        last_focused_window,
    })
}

#[command]
pub fn debug_emit_file_changed(
    app: AppHandle,
    window: WebviewWindow,
    relative_path: String,
    tree_changed: Option<bool>,
) -> AppResult<()> {
    ensure_debug_build()?;
    app.emit_to(
        window.label(),
        "file-changed",
        &json!({
            "path": relative_path,
            "treeChanged": tree_changed.unwrap_or(false),
        }),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::NativeDebugState;

    #[test]
    fn native_debug_state_serializes_as_frontend_camel_case() {
        let state = NativeDebugState {
            project_root: Some("/tmp/project".to_string()),
            project_generation: Some(1),
            watcher_root: Some("/tmp/project".to_string()),
            watcher_generation: Some(2),
            watcher_active: true,
            last_focused_window: Some("main".to_string()),
        };
        let json = serde_json::to_value(&state).expect("serialize NativeDebugState");

        assert_eq!(json["projectRoot"], "/tmp/project");
        assert_eq!(json["projectGeneration"], 1);
        assert_eq!(json["watcherRoot"], "/tmp/project");
        assert_eq!(json["watcherGeneration"], 2);
        assert_eq!(json["watcherActive"], true);
        assert_eq!(json["lastFocusedWindow"], "main");
        assert!(json.get("project_root").is_none());
        assert!(json.get("watcher_active").is_none());
    }
}
