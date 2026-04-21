use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError};
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
    pending: HashMap<PathBuf, QueuedFileChangedEvent>,
}

impl DebouncedEventDispatcher {
    fn new(debounce_window: Duration) -> Self {
        Self {
            attached: false,
            debounce_window,
            buffered: VecDeque::new(),
            pending: HashMap::new(),
        }
    }

    fn handle_message(&mut self, message: WatchEventMessage) {
        match message {
            WatchEventMessage::Attached => {
                self.attached = true;
                while let Some(event) = self.buffered.pop_front() {
                    self.queue_pending(event);
                }
            }
            WatchEventMessage::FileChanged(event) => {
                if self.attached {
                    self.queue_pending(event);
                } else {
                    self.buffered.push_back(event);
                }
            }
        }
    }

    fn flush_due<F>(&mut self, now: Instant, emit: &mut F)
    where
        F: FnMut(&FileChangedEvent),
    {
        let mut due_paths: Vec<PathBuf> = self
            .pending
            .iter()
            .filter(|(_, event)| event_is_due(event, now, self.debounce_window))
            .map(|(path, _)| path.clone())
            .collect();
        due_paths.sort_by_key(|path| {
            self.pending
                .get(path)
                .map(|event| (event.observed_at, path.clone()))
        });

        for path in due_paths {
            if let Some(event) = self.pending.remove(&path) {
                emit(&event.payload);
            }
        }
    }

    fn next_deadline(&self) -> Option<Instant> {
        self.pending
            .values()
            .map(|event| event.observed_at + self.debounce_window)
            .min()
    }

    fn queue_pending(&mut self, mut event: QueuedFileChangedEvent) {
        let path = event.absolute_path.clone();
        if let Some(previous) = self.pending.remove(&path) {
            event.payload.tree_changed =
                previous.payload.tree_changed || event.payload.tree_changed;
        }
        self.pending.insert(path, event);
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
            let mut emit = |payload: &FileChangedEvent| {
                let _ = app.emit_to(window_label.as_str(), "file-changed", payload);
            };

            loop {
                let now = Instant::now();
                dispatcher.flush_due(now, &mut emit);

                let message = match dispatcher.next_deadline() {
                    Some(deadline) => {
                        match receiver.recv_timeout(deadline.saturating_duration_since(now)) {
                            Ok(message) => message,
                            Err(RecvTimeoutError::Timeout) => continue,
                            Err(RecvTimeoutError::Disconnected) => break,
                        }
                    }
                    None => match receiver.recv() {
                        Ok(message) => message,
                        Err(_) => break,
                    },
                };

                dispatcher.handle_message(message);
                dispatcher.flush_due(Instant::now(), &mut emit);
            }
        })
        .map_err(|e| format!("Failed to start file watcher debounce worker: {}", e))?;

    Ok(sender)
}

fn event_is_due(event: &QueuedFileChangedEvent, now: Instant, debounce_window: Duration) -> bool {
    now.checked_duration_since(event.observed_at)
        .is_some_and(|elapsed| elapsed >= debounce_window)
}

#[cfg(test)]
mod tests {
    use super::{
        DebouncedEventDispatcher, FileChangedEvent, QueuedFileChangedEvent, WatchEventMessage,
    };
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    fn queued_event(
        path: &str,
        observed_at: Instant,
        tree_changed: bool,
        generation: u64,
    ) -> QueuedFileChangedEvent {
        QueuedFileChangedEvent {
            absolute_path: PathBuf::from(path),
            observed_at,
            payload: FileChangedEvent {
                path: path.to_string(),
                tree_changed,
                generation,
                root: "/tmp/project".to_string(),
            },
        }
    }

    #[test]
    fn emits_latest_event_after_the_quiet_window() {
        let now = Instant::now();
        let mut dispatcher = DebouncedEventDispatcher::new(Duration::from_millis(500));
        let mut emitted = Vec::new();

        dispatcher.handle_message(WatchEventMessage::Attached);
        dispatcher.handle_message(WatchEventMessage::FileChanged(queued_event(
            "notes/index.md",
            now,
            false,
            1,
        )));
        dispatcher.handle_message(WatchEventMessage::FileChanged(queued_event(
            "notes/index.md",
            now + Duration::from_millis(200),
            false,
            2,
        )));

        dispatcher.flush_due(now + Duration::from_millis(699), &mut |payload| {
            emitted.push(payload.clone())
        });
        assert!(emitted.is_empty());

        dispatcher.flush_due(now + Duration::from_millis(700), &mut |payload| {
            emitted.push(payload.clone())
        });
        assert_eq!(
            emitted,
            vec![FileChangedEvent {
                path: "notes/index.md".to_string(),
                tree_changed: false,
                generation: 2,
                root: "/tmp/project".to_string(),
            }],
        );
    }

    #[test]
    fn buffers_events_until_the_watcher_is_attached() {
        let now = Instant::now();
        let mut dispatcher = DebouncedEventDispatcher::new(Duration::from_millis(500));
        let mut emitted = Vec::new();

        dispatcher.handle_message(WatchEventMessage::FileChanged(queued_event(
            "notes/index.md",
            now,
            false,
            1,
        )));

        assert!(emitted.is_empty());

        dispatcher.handle_message(WatchEventMessage::Attached);
        dispatcher.flush_due(now + Duration::from_millis(499), &mut |payload| {
            emitted.push(payload.clone())
        });
        assert!(emitted.is_empty());

        dispatcher.flush_due(now + Duration::from_millis(500), &mut |payload| {
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
    fn coalesces_buffered_duplicates_to_the_latest_event() {
        let now = Instant::now();
        let mut dispatcher = DebouncedEventDispatcher::new(Duration::from_millis(500));
        let mut emitted = Vec::new();

        dispatcher.handle_message(WatchEventMessage::FileChanged(queued_event(
            "notes/index.md",
            now,
            false,
            1,
        )));
        dispatcher.handle_message(WatchEventMessage::FileChanged(queued_event(
            "notes/index.md",
            now + Duration::from_millis(200),
            false,
            2,
        )));

        dispatcher.handle_message(WatchEventMessage::Attached);
        dispatcher.flush_due(now + Duration::from_millis(700), &mut |payload| {
            emitted.push(payload.clone())
        });

        assert_eq!(
            emitted,
            vec![FileChangedEvent {
                path: "notes/index.md".to_string(),
                tree_changed: false,
                generation: 2,
                root: "/tmp/project".to_string(),
            }],
        );
    }

    #[test]
    fn preserves_tree_changed_when_structural_events_are_coalesced() {
        let now = Instant::now();
        let mut dispatcher = DebouncedEventDispatcher::new(Duration::from_millis(500));
        let mut emitted = Vec::new();

        dispatcher.handle_message(WatchEventMessage::Attached);
        dispatcher.handle_message(WatchEventMessage::FileChanged(queued_event(
            "notes/index.md",
            now,
            true,
            1,
        )));
        dispatcher.handle_message(WatchEventMessage::FileChanged(queued_event(
            "notes/index.md",
            now + Duration::from_millis(100),
            false,
            2,
        )));

        dispatcher.flush_due(now + Duration::from_millis(600), &mut |payload| {
            emitted.push(payload.clone())
        });

        assert_eq!(
            emitted,
            vec![FileChangedEvent {
                path: "notes/index.md".to_string(),
                tree_changed: true,
                generation: 2,
                root: "/tmp/project".to_string(),
            }],
        );
    }

    #[test]
    fn re_emits_paths_after_each_quiet_window() {
        let now = Instant::now();
        let mut dispatcher = DebouncedEventDispatcher::new(Duration::from_millis(500));
        let mut emitted = Vec::new();

        dispatcher.handle_message(WatchEventMessage::Attached);
        dispatcher.handle_message(WatchEventMessage::FileChanged(queued_event(
            "notes/index.md",
            now,
            false,
            1,
        )));
        dispatcher.flush_due(now + Duration::from_millis(500), &mut |payload| {
            emitted.push(payload.clone())
        });

        dispatcher.handle_message(WatchEventMessage::FileChanged(queued_event(
            "notes/index.md",
            now + Duration::from_millis(750),
            false,
            2,
        )));
        dispatcher.flush_due(now + Duration::from_millis(1250), &mut |payload| {
            emitted.push(payload.clone())
        });

        assert_eq!(
            emitted,
            vec![
                FileChangedEvent {
                    path: "notes/index.md".to_string(),
                    tree_changed: false,
                    generation: 1,
                    root: "/tmp/project".to_string(),
                },
                FileChangedEvent {
                    path: "notes/index.md".to_string(),
                    tree_changed: false,
                    generation: 2,
                    root: "/tmp/project".to_string(),
                },
            ],
        );
    }
}
