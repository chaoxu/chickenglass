use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{
    event::ModifyKind, Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::commands::state::FileWatcherEntry;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FileChangedEvent {
    path: String,
    tree_changed: bool,
    generation: u64,
}

pub enum WatchEventMessage {
    Attached,
    FileChanged(QueuedFileChangedEvent),
}

pub struct QueuedFileChangedEvent {
    absolute_path: PathBuf,
    observed_at: Instant,
    payload: FileChangedEvent,
}

struct DebouncedEventDispatcher {
    attached: bool,
    debounce_window: Duration,
    pending: HashMap<PathBuf, QueuedFileChangedEvent>,
}

impl DebouncedEventDispatcher {
    fn new(debounce_window: Duration) -> Self {
        Self {
            attached: false,
            debounce_window,
            pending: HashMap::new(),
        }
    }

    fn handle_message(&mut self, message: WatchEventMessage) {
        match message {
            WatchEventMessage::Attached => {
                self.attached = true;
            }
            WatchEventMessage::FileChanged(event) => {
                self.queue_event(event);
            }
        }
    }

    fn queue_event(&mut self, event: QueuedFileChangedEvent) {
        self.pending
            .entry(event.absolute_path.clone())
            .and_modify(|pending| {
                let tree_changed = pending.payload.tree_changed || event.payload.tree_changed;
                if event.observed_at >= pending.observed_at {
                    pending.observed_at = event.observed_at;
                    pending.payload = event.payload.clone();
                }
                pending.payload.tree_changed = tree_changed;
            })
            .or_insert(event);
    }

    fn time_until_next_deadline(&self, now: Instant) -> Option<Duration> {
        if !self.attached {
            return None;
        }

        self.pending
            .values()
            .map(|event| (event.observed_at + self.debounce_window).saturating_duration_since(now))
            .min()
    }

    fn emit_ready<F>(&mut self, now: Instant, emit: &mut F)
    where
        F: FnMut(&FileChangedEvent),
    {
        if !self.attached {
            return;
        }

        let ready_paths = self
            .pending
            .iter()
            .filter_map(|(path, event)| {
                let deadline = event.observed_at + self.debounce_window;
                (now >= deadline).then(|| path.clone())
            })
            .collect::<Vec<_>>();

        for path in ready_paths {
            if let Some(event) = self.pending.remove(&path) {
                emit(&event.payload);
            }
        }
    }
}

pub fn spawn_debounced_event_worker(
    app: AppHandle,
    window_label: String,
    debounce_window: Duration,
) -> Result<mpsc::Sender<WatchEventMessage>, String> {
    let (sender, receiver) = mpsc::channel();

    std::thread::Builder::new()
        .name("file-watcher-debounce".to_string())
        .spawn(move || {
            let mut dispatcher = DebouncedEventDispatcher::new(debounce_window);
            let mut emit_payload = |payload: &FileChangedEvent| {
                let _ = app.emit_to(window_label.as_str(), "file-changed", payload);
            };

            loop {
                let maybe_message = match dispatcher.time_until_next_deadline(Instant::now()) {
                    Some(timeout) => match receiver.recv_timeout(timeout) {
                        Ok(message) => Some(message),
                        Err(mpsc::RecvTimeoutError::Timeout) => None,
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    },
                    None => match receiver.recv() {
                        Ok(message) => Some(message),
                        Err(_) => break,
                    },
                };

                if let Some(message) = maybe_message {
                    dispatcher.handle_message(message);
                }

                dispatcher.emit_ready(Instant::now(), &mut emit_payload);
            }
        })
        .map_err(|e| format!("Failed to start file watcher debounce worker: {}", e))?;

    Ok(sender)
}

pub fn create_directory_watcher(
    root: PathBuf,
    generation: u64,
    event_sender: mpsc::Sender<WatchEventMessage>,
) -> Result<RecommendedWatcher, String> {
    let root_for_closure = root.clone();
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

fn should_ignore_relative_path(relative: &str) -> bool {
    relative.starts_with('.')
        || relative.contains("/.")
        || relative.starts_with("node_modules")
        || relative.contains("/node_modules")
        || relative.starts_with("target")
        || relative.contains("/target")
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

#[cfg(test)]
mod tests {
    use super::{
        event_changes_tree, normalize_relative_event_path, remove_watcher_generation,
        reserve_watcher_slot, should_ignore_relative_path, DebouncedEventDispatcher,
        FileChangedEvent, QueuedFileChangedEvent, WatchEventMessage,
    };
    use crate::commands::state::FileWatcherEntry;
    use notify::{
        event::{CreateKind, ModifyKind, RemoveKind, RenameMode},
        EventKind,
    };
    use std::collections::HashMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    fn queued_event(
        path: &str,
        observed_at: Instant,
        tree_changed: bool,
    ) -> QueuedFileChangedEvent {
        QueuedFileChangedEvent {
            absolute_path: PathBuf::from(path),
            observed_at,
            payload: FileChangedEvent {
                path: path.to_string(),
                tree_changed,
                generation: 0,
            },
        }
    }

    #[test]
    fn ignores_hidden_and_generated_relative_paths() {
        assert!(should_ignore_relative_path(".git/config"));
        assert!(should_ignore_relative_path("nested/.cache/file.txt"));
        assert!(should_ignore_relative_path("node_modules/pkg/index.js"));
        assert!(should_ignore_relative_path("target/debug/app"));
        assert!(!should_ignore_relative_path("notes/index.md"));
    }

    #[test]
    fn coalesces_same_path_events_until_the_quiet_deadline() {
        let debounce_window = Duration::from_millis(500);
        let now = Instant::now();
        let mut dispatcher = DebouncedEventDispatcher::new(debounce_window);
        let mut emitted = Vec::new();

        dispatcher.handle_message(WatchEventMessage::Attached);
        dispatcher.handle_message(WatchEventMessage::FileChanged(queued_event(
            "notes/index.md",
            now,
            true,
        )));
        dispatcher.handle_message(WatchEventMessage::FileChanged(queued_event(
            "notes/index.md",
            now + Duration::from_millis(200),
            false,
        )));

        dispatcher.emit_ready(now + Duration::from_millis(699), &mut |payload| {
            emitted.push(payload.clone())
        });
        assert!(emitted.is_empty());

        dispatcher.emit_ready(now + Duration::from_millis(700), &mut |payload| {
            emitted.push(payload.clone())
        });

        assert_eq!(
            emitted,
            vec![FileChangedEvent {
                path: "notes/index.md".to_string(),
                tree_changed: true,
                generation: 0,
            }],
        );
    }

    #[test]
    fn keeps_latest_observation_when_same_path_events_arrive_out_of_order() {
        let now = Instant::now();
        let mut dispatcher = DebouncedEventDispatcher::new(Duration::from_millis(500));
        let mut emitted = Vec::new();

        dispatcher.handle_message(WatchEventMessage::Attached);
        dispatcher.handle_message(WatchEventMessage::FileChanged(queued_event(
            "notes/index.md",
            now + Duration::from_millis(200),
            false,
        )));
        dispatcher.handle_message(WatchEventMessage::FileChanged(queued_event(
            "notes/index.md",
            now,
            true,
        )));

        dispatcher.emit_ready(now + Duration::from_millis(699), &mut |payload| {
            emitted.push(payload.clone())
        });
        assert!(emitted.is_empty());

        dispatcher.emit_ready(now + Duration::from_millis(700), &mut |payload| {
            emitted.push(payload.clone())
        });
        assert_eq!(
            emitted,
            vec![FileChangedEvent {
                path: "notes/index.md".to_string(),
                tree_changed: true,
                generation: 0,
            }],
        );
    }

    #[test]
    fn keeps_unattached_events_pending_until_attachment_and_quiet_deadline() {
        let now = Instant::now();
        let mut dispatcher = DebouncedEventDispatcher::new(Duration::from_millis(500));
        let mut emitted = Vec::new();

        dispatcher.handle_message(WatchEventMessage::FileChanged(queued_event(
            "notes/index.md",
            now,
            false,
        )));

        dispatcher.emit_ready(now + Duration::from_secs(1), &mut |payload| {
            emitted.push(payload.clone())
        });
        assert!(emitted.is_empty());

        dispatcher.handle_message(WatchEventMessage::Attached);
        dispatcher.emit_ready(now + Duration::from_secs(1), &mut |payload| {
            emitted.push(payload.clone())
        });
        assert_eq!(
            emitted,
            vec![FileChangedEvent {
                path: "notes/index.md".to_string(),
                tree_changed: false,
                generation: 0,
            }],
        );
    }

    #[test]
    fn reports_next_deadline_only_after_attachment() {
        let now = Instant::now();
        let mut dispatcher = DebouncedEventDispatcher::new(Duration::from_millis(500));

        dispatcher.handle_message(WatchEventMessage::FileChanged(queued_event(
            "notes/index.md",
            now,
            false,
        )));
        assert_eq!(dispatcher.time_until_next_deadline(now), None);

        dispatcher.handle_message(WatchEventMessage::Attached);
        assert_eq!(
            dispatcher.time_until_next_deadline(now + Duration::from_millis(200)),
            Some(Duration::from_millis(300)),
        );
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
