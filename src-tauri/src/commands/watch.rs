use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, State, WebviewWindow, command};

use super::context::{CommandSpec, run_command};
use super::state::{FileWatcherState, PerfState};
use crate::services::path::path_to_frontend_string;
use crate::services::watch::{
    WatchEventMessage, attach_watcher, create_directory_watcher, remove_watcher_generation,
    reserve_watcher_slot, spawn_debounced_event_worker,
};

const WATCH_DIRECTORY: CommandSpec = CommandSpec::new(
    "tauri.watch_directory",
    "tauri.watch.watch_directory",
    "tauri",
);
const UNWATCH_DIRECTORY: CommandSpec = CommandSpec::new(
    "tauri.unwatch_directory",
    "tauri.watch.unwatch_directory",
    "tauri",
);
const DEFAULT_WATCH_DEBOUNCE_MS: u64 = 500;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchDirectoryResult {
    pub applied: bool,
    pub root: String,
}

#[command]
pub fn watch_directory(
    app: AppHandle,
    window: WebviewWindow,
    watcher_state: State<'_, FileWatcherState>,
    perf: State<'_, PerfState>,
    path: String,
    generation: u64,
    debounce_ms: Option<u64>,
) -> Result<WatchDirectoryResult, String> {
    run_command(&perf, WATCH_DIRECTORY, Some(&path), || {
        let watch_path = map_err_str!(
            PathBuf::from(&path).canonicalize(),
            "Cannot resolve path '{}': {}",
            path
        )?;

        if !watch_path.is_dir() {
            return Err(format!("Not a directory: {}", watch_path.display()));
        }
        let watch_root = path_to_frontend_string(&watch_path, "Watch root path")?;

        let window_label = window.label().to_string();
        {
            let mut lock = watcher_state.0.lock().map_err(|e| e.to_string())?;
            if !reserve_watcher_slot(&mut lock, &window_label, watch_path.clone(), generation) {
                return Ok(WatchDirectoryResult {
                    applied: false,
                    root: watch_root,
                });
            }
        }

        let debounce_ms = Duration::from_millis(debounce_ms.unwrap_or(DEFAULT_WATCH_DEBOUNCE_MS));
        let event_sender =
            spawn_debounced_event_worker(app.clone(), window_label.clone(), debounce_ms)?;
        let watcher = create_directory_watcher(watch_path, generation, event_sender.clone())?;

        let mut lock = watcher_state.0.lock().map_err(|e| e.to_string())?;
        let attached = attach_watcher(&mut lock, &window_label, generation, watcher);
        drop(lock);

        if attached {
            let _ = event_sender.send(WatchEventMessage::Attached);
        }

        Ok(WatchDirectoryResult {
            applied: attached,
            root: watch_root,
        })
    })
}

#[command]
pub fn unwatch_directory(
    window: WebviewWindow,
    watcher_state: State<'_, FileWatcherState>,
    perf: State<'_, PerfState>,
    generation: u64,
) -> Result<bool, String> {
    run_command(&perf, UNWATCH_DIRECTORY, None, || {
        let mut lock = watcher_state.0.lock().map_err(|e| e.to_string())?;
        Ok(remove_watcher_generation(
            &mut lock,
            window.label(),
            generation,
        ))
    })
}
