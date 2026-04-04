use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify::{
    Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher, event::ModifyKind,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State, WebviewWindow, command};

use super::perf::measure_command;
use super::state::{FileWatcherEntry, FileWatcherState, PerfState};

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChangedEvent {
    path: String,
    tree_changed: bool,
}

fn event_changes_tree(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
    )
}

fn normalize_relative_event_path(root: &Path, path: &Path, tree_changed: bool) -> Option<String> {
    if path.is_dir() && !tree_changed {
        return None;
    }

    let relative = path
        .strip_prefix(root)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");

    if should_ignore_relative_path(&relative) {
        return None;
    }

    Some(relative)
}

fn reserve_watcher_slot(
    watchers: &mut HashMap<String, FileWatcherEntry>,
    window_label: &str,
    root: PathBuf,
    generation: u64,
) -> bool {
    if matches!(
        watchers.get(window_label),
        Some(existing) if existing.generation > generation
    ) {
        return false;
    }

    watchers.insert(
        window_label.to_string(),
        FileWatcherEntry {
            generation,
            root,
            watcher: None,
        },
    );
    true
}

fn attach_watcher(
    watchers: &mut HashMap<String, FileWatcherEntry>,
    window_label: &str,
    generation: u64,
    watcher: RecommendedWatcher,
) -> bool {
    let Some(entry) = watchers.get_mut(window_label) else {
        return false;
    };
    if entry.generation != generation {
        return false;
    }

    entry.watcher = Some(watcher);
    true
}

fn remove_watcher_generation(
    watchers: &mut HashMap<String, FileWatcherEntry>,
    window_label: &str,
    generation: u64,
) -> bool {
    if !matches!(
        watchers.get(window_label),
        Some(existing) if existing.generation == generation
    ) {
        return false;
    }

    watchers.remove(window_label);
    true
}

/// Start watching a directory for file changes.
#[command]
pub fn watch_directory(
    app: AppHandle,
    window: WebviewWindow,
    watcher_state: State<'_, FileWatcherState>,
    perf: State<'_, PerfState>,
    path: String,
    generation: u64,
) -> Result<bool, String> {
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

            let window_label = window.label().to_string();
            {
                let mut lock = watcher_state.0.lock().map_err(|e| e.to_string())?;
                if !reserve_watcher_slot(&mut lock, &window_label, watch_path.clone(), generation) {
                    return Ok(false);
                }
            }

            let root_for_closure = watch_path.clone();
            let app_for_closure = app.clone();
            let window_label_for_closure = window_label.clone();
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

                    let tree_changed = event_changes_tree(&event.kind);

                    for path in &event.paths {
                        let Some(relative) =
                            normalize_relative_event_path(&root_for_closure, path, tree_changed)
                        else {
                            continue;
                        };

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

                        let payload = FileChangedEvent {
                            path: relative,
                            tree_changed,
                        };

                        let _ = app_for_closure.emit_to(
                            window_label_for_closure.as_str(),
                            "file-changed",
                            &payload,
                        );
                    }
                },
                Config::default(),
            )
            .map_err(|e| format!("Failed to create watcher: {}", e))?;

            watcher
                .watch(&watch_path, RecursiveMode::Recursive)
                .map_err(|e| format!("Failed to watch directory: {}", e))?;

            let mut lock = watcher_state.0.lock().map_err(|e| e.to_string())?;
            Ok(attach_watcher(
                &mut lock,
                &window_label,
                generation,
                watcher,
            ))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{
        event_changes_tree, normalize_relative_event_path, remove_watcher_generation,
        reserve_watcher_slot, should_emit_debounced_event, should_ignore_relative_path,
    };
    use crate::commands::state::FileWatcherEntry;
    use notify::{
        EventKind,
        event::{CreateKind, ModifyKind, RemoveKind, RenameMode},
    };
    use std::collections::HashMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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

        let should_emit = should_emit_debounced_event(
            &mut last_events,
            Path::new("new.md"),
            now,
            debounce_window,
        );

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

        assert!(should_emit_debounced_event(
            &mut last_events,
            path,
            now,
            debounce_window
        ));
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

        assert!(should_emit_debounced_event(
            &mut last_events,
            path,
            now,
            debounce_window
        ));
        assert!(should_emit_debounced_event(
            &mut last_events,
            path,
            now + Duration::from_millis(750),
            debounce_window,
        ));
    }

    #[test]
    fn structural_events_mark_tree_changes() {
        assert!(event_changes_tree(&EventKind::Create(CreateKind::File)));
        assert!(event_changes_tree(&EventKind::Remove(RemoveKind::File)));
        assert!(event_changes_tree(&EventKind::Modify(ModifyKind::Name(
            RenameMode::Both
        ))));
        assert!(!event_changes_tree(&EventKind::Modify(ModifyKind::Data(
            notify::event::DataChange::Content,
        ))));
    }

    #[test]
    fn includes_directory_paths_for_tree_changes_only() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("coflat-watch-test-{unique}"));
        let dir = root.join("docs/new-subdir");
        fs::create_dir_all(&dir).expect("create test directory");

        assert_eq!(
            normalize_relative_event_path(&root, &dir, true),
            Some("docs/new-subdir".to_string()),
        );
        assert_eq!(normalize_relative_event_path(&root, &dir, false), None);

        fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn watcher_slots_reject_stale_generations() {
        let mut watchers = HashMap::from([(
            "main".to_string(),
            FileWatcherEntry {
                generation: 7,
                root: PathBuf::from("/tmp/project-b"),
                watcher: None,
            },
        )]);

        let reserved =
            reserve_watcher_slot(&mut watchers, "main", PathBuf::from("/tmp/project-a"), 6);

        assert!(!reserved);
        assert_eq!(
            watchers.get("main").map(|entry| entry.root.clone()),
            Some(PathBuf::from("/tmp/project-b")),
        );
    }

    #[test]
    fn watcher_slots_ignore_stale_unwatch_requests() {
        let mut watchers = HashMap::from([(
            "main".to_string(),
            FileWatcherEntry {
                generation: 9,
                root: PathBuf::from("/tmp/project-b"),
                watcher: None,
            },
        )]);

        let removed = remove_watcher_generation(&mut watchers, "main", 8);

        assert!(!removed);
        assert!(watchers.contains_key("main"));
    }
}

/// Stop watching the current directory.
#[command]
pub fn unwatch_directory(
    window: WebviewWindow,
    watcher_state: State<'_, FileWatcherState>,
    perf: State<'_, PerfState>,
    generation: u64,
) -> Result<bool, String> {
    measure_command(
        &perf,
        "tauri.unwatch_directory",
        "tauri.watch.unwatch_directory",
        "tauri",
        None,
        || {
            let mut lock = watcher_state.0.lock().map_err(|e| e.to_string())?;
            Ok(remove_watcher_generation(
                &mut lock,
                window.label(),
                generation,
            ))
        },
    )
}
