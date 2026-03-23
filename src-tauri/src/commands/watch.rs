use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, State, command};

use super::perf::measure_command;
use super::state::FileWatcherState;
use super::state::PerfState;

fn should_ignore_relative_path(relative: &str) -> bool {
    relative.starts_with('.')
        || relative.contains("/.")
        || relative.starts_with("node_modules")
        || relative.contains("/node_modules")
        || relative.starts_with("target")
        || relative.contains("/target")
}

fn should_emit_debounced_event(
    last_events: &mut HashMap<PathBuf, Instant>,
    path: &Path,
    now: Instant,
    debounce_window: Duration,
) -> bool {
    last_events.retain(|_, last_seen| now.duration_since(*last_seen) < debounce_window);

    if let Some(last_seen) = last_events.get(path) {
        if now.duration_since(*last_seen) < debounce_window {
            return false;
        }
    }

    last_events.insert(path.to_path_buf(), now);
    true
}

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

                        let relative = match path.strip_prefix(&root_for_closure) {
                            Ok(relative) => relative.to_string_lossy().replace('\\', "/"),
                            Err(_) => continue,
                        };

                        if should_ignore_relative_path(&relative) {
                            continue;
                        }

                        {
                            let mut map = match last_events_clone.lock() {
                                Ok(map) => map,
                                Err(_) => continue,
                            };
                            let now = Instant::now();
                            if !should_emit_debounced_event(&mut map, path, now, debounce_ms) {
                                continue;
                            }
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

#[cfg(test)]
mod tests {
    use super::{should_emit_debounced_event, should_ignore_relative_path};
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    #[test]
    fn ignores_hidden_and_generated_relative_paths() {
        assert!(should_ignore_relative_path(".git/config"));
        assert!(should_ignore_relative_path("nested/.cache/file.txt"));
        assert!(should_ignore_relative_path("node_modules/pkg/index.js"));
        assert!(should_ignore_relative_path("target/debug/app"));
        assert!(!should_ignore_relative_path("notes/index.md"));
    }

    #[test]
    fn prunes_stale_entries_before_recording_new_paths() {
        let debounce_window = Duration::from_millis(500);
        let now = Instant::now();
        let stale_instant = now - Duration::from_secs(5);
        let mut last_events = HashMap::from([(PathBuf::from("old.md"), stale_instant)]);

        let should_emit =
            should_emit_debounced_event(&mut last_events, Path::new("new.md"), now, debounce_window);

        assert!(should_emit);
        assert_eq!(last_events.len(), 1);
        assert!(last_events.contains_key(Path::new("new.md")));
        assert!(!last_events.contains_key(Path::new("old.md")));
    }

    #[test]
    fn suppresses_duplicate_events_within_the_debounce_window() {
        let debounce_window = Duration::from_millis(500);
        let now = Instant::now();
        let mut last_events = HashMap::new();
        let path = Path::new("notes/index.md");

        assert!(should_emit_debounced_event(&mut last_events, path, now, debounce_window));
        assert!(!should_emit_debounced_event(
            &mut last_events,
            path,
            now + Duration::from_millis(200),
            debounce_window,
        ));
    }

    #[test]
    fn re_emits_paths_after_the_debounce_window_expires() {
        let debounce_window = Duration::from_millis(500);
        let now = Instant::now();
        let mut last_events = HashMap::new();
        let path = Path::new("notes/index.md");

        assert!(should_emit_debounced_event(&mut last_events, path, now, debounce_window));
        assert!(should_emit_debounced_event(
            &mut last_events,
            path,
            now + Duration::from_millis(750),
            debounce_window,
        ));
    }
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
