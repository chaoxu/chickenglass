use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, State, WebviewWindow, command};

use super::context::{CommandSpec, WindowCommandContext, run_command};
use super::state::{FileWatcherState, PerfState, ProjectRoot, WatcherHealthEvent};
use crate::services::path::path_to_frontend_string;
use crate::services::watch::{
    WatchEventMessage, attach_watcher, create_directory_watcher, mark_watcher_health,
    remove_watcher_generation, reserve_watcher_slot, spawn_debounced_event_worker,
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
    root: State<'_, ProjectRoot>,
    watcher_state: State<'_, FileWatcherState>,
    perf: State<'_, PerfState>,
    generation: u64,
    debounce_ms: Option<u64>,
) -> Result<WatchDirectoryResult, String> {
    WindowCommandContext::new(&window, &root, &perf).run(WATCH_DIRECTORY, None, |project_root| {
        let watch_path = resolve_session_watch_path(project_root)?;
        let watch_root = path_to_frontend_string(&watch_path, "Watch root path")?;

        let window_label = window.label().to_string();
        let starting_health = WatcherHealthEvent::starting(generation, watch_root.clone());
        {
            let mut lock = watcher_state.0.lock().map_err(|e| e.to_string())?;
            if !reserve_watcher_slot(
                &mut lock,
                &window_label,
                watch_path.clone(),
                generation,
                starting_health,
            ) {
                return Ok(WatchDirectoryResult {
                    applied: false,
                    root: watch_root,
                });
            }
        }

        let debounce_ms = Duration::from_millis(debounce_ms.unwrap_or(DEFAULT_WATCH_DEBOUNCE_MS));
        let event_sender =
            match spawn_debounced_event_worker(app.clone(), window_label.clone(), debounce_ms) {
                Ok(sender) => sender,
                Err(error) => {
                    mark_failed_watcher(
                        &watcher_state,
                        &window_label,
                        generation,
                        watch_root.clone(),
                        "Failed to start file watcher debounce worker",
                        error.clone(),
                    )?;
                    return Err(error);
                }
            };
        let watcher = match create_directory_watcher(watch_path, generation, event_sender.clone()) {
            Ok(watcher) => watcher,
            Err(error) => {
                mark_failed_watcher(
                    &watcher_state,
                    &window_label,
                    generation,
                    watch_root.clone(),
                    "Failed to start native file watcher",
                    error.clone(),
                )?;
                let _ = event_sender.send(WatchEventMessage::Health(WatcherHealthEvent::failed(
                    generation,
                    watch_root.clone(),
                    "Failed to start native file watcher",
                    error.clone(),
                )));
                return Err(error);
            }
        };

        let mut lock = watcher_state.0.lock().map_err(|e| e.to_string())?;
        let attached = attach_watcher(&mut lock, &window_label, generation, watcher);
        let healthy = WatcherHealthEvent::healthy(generation, watch_root.clone());
        if attached {
            mark_watcher_health(&mut lock, &window_label, generation, healthy.clone());
        }
        drop(lock);

        if attached {
            let _ = event_sender.send(WatchEventMessage::Attached(healthy));
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

fn resolve_session_watch_path(project_root: &std::path::Path) -> Result<PathBuf, String> {
    let watch_path = map_err_str!(
        project_root.canonicalize(),
        "Cannot resolve active project root '{}': {}",
        project_root.display()
    )?;
    if !watch_path.is_dir() {
        return Err(format!("Not a directory: {}", watch_path.display()));
    }
    Ok(watch_path)
}

fn mark_failed_watcher(
    watcher_state: &State<'_, FileWatcherState>,
    window_label: &str,
    generation: u64,
    root: String,
    message: &str,
    error: String,
) -> Result<(), String> {
    let mut lock = watcher_state.0.lock().map_err(|e| e.to_string())?;
    mark_watcher_health(
        &mut lock,
        window_label,
        generation,
        WatcherHealthEvent::failed(generation, root, message, error),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::resolve_session_watch_path;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("coflat-{prefix}-{unique}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path.canonicalize().expect("canonicalize temp dir")
    }

    #[test]
    fn watcher_root_derives_from_backend_project_session() {
        let project_root = create_temp_dir("watch-session-root");

        let watch_path =
            resolve_session_watch_path(&project_root).expect("resolve session watch path");

        assert_eq!(watch_path, project_root);

        fs::remove_dir_all(&project_root).expect("remove project root");
    }
}
