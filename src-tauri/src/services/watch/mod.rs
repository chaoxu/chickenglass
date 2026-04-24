use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Instant;

use notify::{
    Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher, event::ModifyKind,
};

use self::debouncer::{FileChangedEvent, QueuedFileChangedEvent};
use super::path_filter::should_ignore_relative_path;
use crate::commands::state::{FileWatcherEntry, WatcherHealthEvent};
use crate::services::path::path_to_frontend_string;

mod debouncer;

pub(crate) use self::debouncer::{WatchEventMessage, spawn_debounced_event_worker};

pub fn create_directory_watcher(
    root: PathBuf,
    generation: u64,
    event_sender: mpsc::Sender<WatchEventMessage>,
) -> Result<RecommendedWatcher, String> {
    let root_for_closure = root.clone();
    let event_root = path_to_frontend_string(&root, "Watch root path")?;
    let event_sender_for_closure = event_sender.clone();

    let mut watcher = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            queue_notify_result(
                &root_for_closure,
                &event_root,
                generation,
                &event_sender_for_closure,
                result,
            );
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {}", e))?;

    Ok(watcher)
}

pub fn reserve_watcher_slot(
    watchers: &mut HashMap<String, FileWatcherEntry>,
    window_label: &str,
    root: PathBuf,
    generation: u64,
    health: WatcherHealthEvent,
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
            health,
            watcher: None,
        },
    );
    true
}

pub fn attach_watcher(
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

pub fn mark_watcher_health(
    watchers: &mut HashMap<String, FileWatcherEntry>,
    window_label: &str,
    generation: u64,
    health: WatcherHealthEvent,
) -> bool {
    let Some(entry) = watchers.get_mut(window_label) else {
        return false;
    };
    if entry.generation != generation {
        return false;
    }

    entry.health = health;
    true
}

pub fn remove_watcher_generation(
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

fn event_changes_tree(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
    )
}

fn queue_notify_result(
    root: &Path,
    event_root: &str,
    generation: u64,
    event_sender: &mpsc::Sender<WatchEventMessage>,
    result: Result<Event, notify::Error>,
) {
    let event = match result {
        Ok(event) => event,
        Err(error) => {
            let _ = event_sender.send(WatchEventMessage::Health(WatcherHealthEvent::degraded(
                generation,
                event_root.to_string(),
                "Native watcher reported an error",
                error.to_string(),
            )));
            return;
        }
    };

    if !matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    ) {
        return;
    }

    let tree_changed = event_changes_tree(&event.kind);

    for path in &event.paths {
        let relative = match normalize_relative_event_path(root, path, tree_changed) {
            Ok(Some(relative)) => relative,
            Ok(None) => continue,
            Err(error) => {
                let _ = event_sender.send(WatchEventMessage::Health(WatcherHealthEvent::degraded(
                    generation,
                    event_root.to_string(),
                    "Native watcher event path cannot be sent to the frontend",
                    error,
                )));
                continue;
            }
        };

        let payload = FileChangedEvent {
            path: relative,
            tree_changed,
            generation,
            root: event_root.to_string(),
        };

        let _ = event_sender.send(WatchEventMessage::FileChanged(QueuedFileChangedEvent {
            absolute_path: path.to_path_buf(),
            observed_at: Instant::now(),
            payload,
        }));
    }
}

fn normalize_relative_event_path(
    root: &Path,
    path: &Path,
    tree_changed: bool,
) -> Result<Option<String>, String> {
    if path.is_dir() && !tree_changed {
        return Ok(None);
    }

    let Some(relative) = path.strip_prefix(root).ok() else {
        return Ok(None);
    };
    let relative = path_to_frontend_string(relative, "Watch event path")?;

    if should_ignore_relative_path(&relative) {
        return Ok(None);
    }

    Ok(Some(relative))
}

#[cfg(test)]
mod tests {
    use super::{
        WatchEventMessage, event_changes_tree, normalize_relative_event_path, queue_notify_result,
        remove_watcher_generation, reserve_watcher_slot,
    };
    use crate::commands::state::{FileWatcherEntry, WatcherHealth, WatcherHealthEvent};
    use notify::{
        Event, EventKind,
        event::{CreateKind, ModifyKind, RemoveKind, RenameMode},
    };
    use std::collections::HashMap;
    use std::ffi::OsString;
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
            Ok(Some("docs/new-subdir".to_string())),
        );
        assert_eq!(normalize_relative_event_path(&root, &dir, false), Ok(None));

        fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn keeps_regular_files_named_like_ignored_directories() {
        let root = create_temp_dir("watch-target-file");
        let path = root.join("docs/target.md");
        fs::create_dir_all(path.parent().expect("target file parent")).expect("create docs dir");
        fs::write(&path, "hello").expect("create watched file");

        assert_eq!(
            normalize_relative_event_path(&root, &path, false),
            Ok(Some("docs/target.md".to_string())),
        );

        fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_non_utf8_relative_event_paths() {
        use std::os::unix::ffi::OsStringExt;

        let root = create_temp_dir("watch-nonutf8-root");
        let path = root.join(PathBuf::from(OsString::from_vec(vec![
            b'b', b'a', b'd', 0x80,
        ])));

        let err = normalize_relative_event_path(&root, &path, false)
            .expect_err("non-utf8 watch paths should fail");
        assert!(err.contains("Watch event path is not valid UTF-8"));

        fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn watcher_slots_reject_stale_generations() {
        let mut watchers = HashMap::from([(
            "main".to_string(),
            FileWatcherEntry {
                generation: 7,
                root: PathBuf::from("/tmp/project-b"),
                health: WatcherHealthEvent::healthy(7, "/tmp/project-b".to_string()),
                watcher: None,
            },
        )]);

        let reserved = reserve_watcher_slot(
            &mut watchers,
            "main",
            PathBuf::from("/tmp/project-a"),
            6,
            WatcherHealthEvent::starting(6, "/tmp/project-a".to_string()),
        );

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
                health: WatcherHealthEvent::healthy(9, "/tmp/project-b".to_string()),
                watcher: None,
            },
        )]);

        let removed = remove_watcher_generation(&mut watchers, "main", 8);

        assert!(!removed);
        assert!(watchers.contains_key("main"));
    }

    #[test]
    fn notify_errors_emit_degraded_health_events() {
        let (sender, receiver) = std::sync::mpsc::channel();
        let root = PathBuf::from("/tmp/project");

        queue_notify_result(
            &root,
            "/tmp/project",
            3,
            &sender,
            Err(notify::Error::generic("backend unavailable")),
        );

        let message = receiver.recv().expect("watch health event");
        match message {
            WatchEventMessage::Health(health) => {
                assert_eq!(health.status, WatcherHealth::Degraded);
                assert_eq!(health.generation, 3);
                assert_eq!(health.root, "/tmp/project");
                assert!(
                    health
                        .error
                        .as_deref()
                        .is_some_and(|error: &str| { error.contains("backend unavailable") })
                );
            }
            _ => panic!("expected health event"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_notify_paths_emit_degraded_health_events() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        let (sender, receiver) = std::sync::mpsc::channel();
        let root = create_temp_dir("watch-nonutf8-event-root");
        let path = root.join(PathBuf::from(OsString::from_vec(vec![
            b'b', b'a', b'd', 0x80,
        ])));
        let event = Event {
            kind: EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Content)),
            paths: vec![path],
            attrs: notify::event::EventAttributes::new(),
        };

        queue_notify_result(&root, "/tmp/project", 4, &sender, Ok(event));

        let message = receiver.recv().expect("watch health event");
        match message {
            WatchEventMessage::Health(health) => {
                assert_eq!(health.status, WatcherHealth::Degraded);
                assert_eq!(health.generation, 4);
                assert!(health.error.as_deref().is_some_and(|error: &str| {
                    error.contains("Watch event path is not valid UTF-8")
                }));
            }
            _ => panic!("expected health event"),
        }

        fs::remove_dir_all(&root).expect("remove test directory");
    }
}
