use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct FileChangedEvent {
    pub(super) path: String,
    pub(super) tree_changed: bool,
    pub(super) generation: u64,
    pub(super) root: String,
}

pub(crate) enum WatchEventMessage {
    Attached,
    FileChanged(QueuedFileChangedEvent),
}

pub(crate) struct QueuedFileChangedEvent {
    pub(super) absolute_path: PathBuf,
    pub(super) observed_at: Instant,
    pub(super) payload: FileChangedEvent,
}

struct DebouncedEventDispatcher {
    attached: bool,
    debounce_window: Duration,
    buffered: VecDeque<QueuedFileChangedEvent>,
    last_events: HashMap<PathBuf, Instant>,
}

impl DebouncedEventDispatcher {
    fn new(debounce_window: Duration) -> Self {
        Self {
            attached: false,
            debounce_window,
            buffered: VecDeque::new(),
            last_events: HashMap::new(),
        }
    }

    fn handle_message<F>(&mut self, message: WatchEventMessage, emit: &mut F)
    where
        F: FnMut(&FileChangedEvent),
    {
        match message {
            WatchEventMessage::Attached => {
                self.attached = true;
                while let Some(event) = self.buffered.pop_front() {
                    self.emit_if_ready(event, emit);
                }
            }
            WatchEventMessage::FileChanged(event) => {
                if self.attached {
                    self.emit_if_ready(event, emit);
                } else {
                    self.buffered.push_back(event);
                }
            }
        }
    }

    fn emit_if_ready<F>(&mut self, event: QueuedFileChangedEvent, emit: &mut F)
    where
        F: FnMut(&FileChangedEvent),
    {
        if !should_emit_debounced_event(
            &mut self.last_events,
            &event.absolute_path,
            event.observed_at,
            self.debounce_window,
        ) {
            return;
        }

        emit(&event.payload);
    }
}

pub(crate) fn spawn_debounced_event_worker(
    app: AppHandle,
    window_label: String,
    debounce_window: Duration,
) -> Result<mpsc::Sender<WatchEventMessage>, String> {
    let (sender, receiver) = mpsc::channel();

    std::thread::Builder::new()
        .name("file-watcher-debounce".to_string())
        .spawn(move || {
            let mut dispatcher = DebouncedEventDispatcher::new(debounce_window);
            while let Ok(message) = receiver.recv() {
                dispatcher.handle_message(message, &mut |payload| {
                    let _ = app.emit_to(window_label.as_str(), "file-changed", payload);
                });
            }
        })
        .map_err(|e| format!("Failed to start file watcher debounce worker: {}", e))?;

    Ok(sender)
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

#[cfg(test)]
mod tests {
    use super::{
        DebouncedEventDispatcher, FileChangedEvent, QueuedFileChangedEvent, WatchEventMessage,
        should_emit_debounced_event,
    };
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

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
    fn buffers_events_until_the_watcher_is_attached() {
        let now = Instant::now();
        let mut dispatcher = DebouncedEventDispatcher::new(Duration::from_millis(500));
        let mut emitted = Vec::new();

        dispatcher.handle_message(
            WatchEventMessage::FileChanged(QueuedFileChangedEvent {
                absolute_path: PathBuf::from("notes/index.md"),
                observed_at: now,
                payload: FileChangedEvent {
                    path: "notes/index.md".to_string(),
                    tree_changed: false,
                    generation: 1,
                    root: "/tmp/project".to_string(),
                },
            }),
            &mut |payload| emitted.push(payload.clone()),
        );

        assert!(emitted.is_empty());

        dispatcher.handle_message(WatchEventMessage::Attached, &mut |payload| {
            emitted.push(payload.clone())
        });

        assert_eq!(
            emitted,
            vec![FileChangedEvent {
                path: "notes/index.md".to_string(),
                tree_changed: false,
                generation: 1,
                root: "/tmp/project".to_string(),
            }],
        );
    }

    #[test]
    fn suppresses_buffered_duplicates_when_attachment_flushes_them() {
        let now = Instant::now();
        let mut dispatcher = DebouncedEventDispatcher::new(Duration::from_millis(500));
        let mut emitted = Vec::new();

        dispatcher.handle_message(
            WatchEventMessage::FileChanged(QueuedFileChangedEvent {
                absolute_path: PathBuf::from("notes/index.md"),
                observed_at: now,
                payload: FileChangedEvent {
                    path: "notes/index.md".to_string(),
                    tree_changed: false,
                    generation: 1,
                    root: "/tmp/project".to_string(),
                },
            }),
            &mut |payload| emitted.push(payload.clone()),
        );
        dispatcher.handle_message(
            WatchEventMessage::FileChanged(QueuedFileChangedEvent {
                absolute_path: PathBuf::from("notes/index.md"),
                observed_at: now + Duration::from_millis(200),
                payload: FileChangedEvent {
                    path: "notes/index.md".to_string(),
                    tree_changed: false,
                    generation: 1,
                    root: "/tmp/project".to_string(),
                },
            }),
            &mut |payload| emitted.push(payload.clone()),
        );

        dispatcher.handle_message(WatchEventMessage::Attached, &mut |payload| {
            emitted.push(payload.clone())
        });

        assert_eq!(
            emitted,
            vec![FileChangedEvent {
                path: "notes/index.md".to_string(),
                tree_changed: false,
                generation: 1,
                root: "/tmp/project".to_string(),
            }],
        );
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
}
