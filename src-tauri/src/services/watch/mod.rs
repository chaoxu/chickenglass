use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Instant;

use notify::{
    Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher, event::ModifyKind,
};

use self::debouncer::{FileChangedEvent, QueuedFileChangedEvent};
use super::path_filter::should_ignore_relative_path;
use crate::commands::state::FileWatcherEntry;
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

                let payload = FileChangedEvent {
                    path: relative,
                    tree_changed,
                    generation,
                    root: event_root.clone(),
                };

                let _ = event_sender_for_closure.send(WatchEventMessage::FileChanged(
                    QueuedFileChangedEvent {
                        absolute_path: path.to_path_buf(),
                        observed_at: Instant::now(),
                        payload,
                    },
                ));
            }
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

fn normalize_relative_event_path(root: &Path, path: &Path, tree_changed: bool) -> Option<String> {
    if path.is_dir() && !tree_changed {
        return None;
    }

    let relative = path.strip_prefix(root).ok()?;
    let relative = match path_to_frontend_string(relative, "Watch event path") {
        Ok(relative) => relative,
        Err(error) => {
            eprintln!("[watch] {}", error);
            return None;
        }
    };

    if should_ignore_relative_path(&relative) {
        return None;
    }

    Some(relative)
}

#[cfg(test)]
mod tests {
    use super::{
        event_changes_tree, normalize_relative_event_path, remove_watcher_generation,
        reserve_watcher_slot,
    };
    use crate::commands::state::FileWatcherEntry;
    use notify::{
        EventKind,
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
            Some("docs/new-subdir".to_string()),
        );
        assert_eq!(normalize_relative_event_path(&root, &dir, false), None);

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
            Some("docs/target.md".to_string()),
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

        assert_eq!(normalize_relative_event_path(&root, &path, false), None);

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
