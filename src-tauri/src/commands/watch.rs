use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, State, command};

use super::perf::measure_command;
use super::state::FileWatcherState;
use super::state::PerfState;

/// Start watching a directory for file changes.
#[command]
pub fn watch_directory(
    app: AppHandle,
    watcher_state: State<'_, FileWatcherState>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<(), String> {
    measure_command(
        &perf,
        "tauri.watch_directory",
        "tauri.watch.watch_directory",
        "tauri",
        Some(&path),
        || {
            let watch_path = PathBuf::from(&path)
                .canonicalize()
                .map_err(|e| format!("Cannot resolve path '{}': {}", path, e))?;

            if !watch_path.is_dir() {
                return Err(format!("Not a directory: {}", watch_path.display()));
            }

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
                        Ok(event) => event,
                        Err(_) => return,
                    };

                    if !matches!(
                        event.kind,
                        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                    ) {
                        return;
                    }

                    for path in &event.paths {
                        if path.is_dir() {
                            continue;
                        }

                        {
                            let mut map = match last_events_clone.lock() {
                                Ok(map) => map,
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

                        let relative = match path.strip_prefix(&root_for_closure) {
                            Ok(relative) => relative.to_string_lossy().replace('\\', "/"),
                            Err(_) => continue,
                        };

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

            *lock = Some(watcher);
            Ok(())
        },
    )
}

/// Stop watching the current directory.
#[command]
pub fn unwatch_directory(
    watcher_state: State<'_, FileWatcherState>,
    perf: State<'_, PerfState>,
) -> Result<(), String> {
    measure_command(
        &perf,
        "tauri.unwatch_directory",
        "tauri.watch.unwatch_directory",
        "tauri",
        None,
        || {
            let mut lock = watcher_state.0.lock().map_err(|e| e.to_string())?;
            *lock = None;
            Ok(())
        },
    )
}
