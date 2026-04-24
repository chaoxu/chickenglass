use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::commands::state::WatcherHealthEvent;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct FileChangedEvent {
    pub(super) path: String,
    pub(super) tree_changed: bool,
    pub(super) generation: u64,
    pub(super) root: String,
}

#[derive(Debug)]
pub(crate) enum WatchEventMessage {
    Attached(WatcherHealthEvent),
    FileChanged(QueuedFileChangedEvent),
    Health(WatcherHealthEvent),
}

#[derive(Debug)]
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

    fn handle_message<F>(&mut self, message: WatchEventMessage, emit_status: &mut F)
    where
        F: FnMut(&WatcherHealthEvent),
    {
        match message {
            WatchEventMessage::Attached(status) => {
                self.attached = true;
                emit_status(&status);
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
            WatchEventMessage::Health(status) => {
                emit_status(&status);
            }
        }
    }

    fn flush_due<F, S>(&mut self, now: Instant, emit: &mut F, emit_status: &mut S)
    where
        F: FnMut(&FileChangedEvent) -> Result<(), String>,
        S: FnMut(&WatcherHealthEvent),
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
                if let Err(error) = emit(&event.payload) {
                    emit_status(&WatcherHealthEvent::degraded(
                        event.payload.generation,
                        event.payload.root.clone(),
                        "Failed to emit file watcher change event",
                        error,
                    ));
                }
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
                app.emit_to(window_label.as_str(), "file-changed", payload)
                    .map_err(|e| e.to_string())
            };
            let mut emit_status = |payload: &WatcherHealthEvent| {
                if let Err(error) = app.emit_to(window_label.as_str(), "watch-status", payload) {
                    eprintln!("[watch] failed to emit watcher health event: {}", error);
                }
            };

            loop {
                let now = Instant::now();
                dispatcher.flush_due(now, &mut emit, &mut emit_status);

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

                dispatcher.handle_message(message, &mut emit_status);
                dispatcher.flush_due(Instant::now(), &mut emit, &mut emit_status);
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
    use crate::commands::state::{WatcherHealth, WatcherHealthEvent};
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

        dispatcher.handle_message(
            WatchEventMessage::Attached(WatcherHealthEvent::healthy(1, "/tmp/project".to_string())),
            &mut |_| {},
        );
        dispatcher.handle_message(
            WatchEventMessage::FileChanged(queued_event("notes/index.md", now, false, 1)),
            &mut |_| {},
        );
        dispatcher.handle_message(
            WatchEventMessage::FileChanged(queued_event(
                "notes/index.md",
                now + Duration::from_millis(200),
                false,
                2,
            )),
            &mut |_| {},
        );

        dispatcher.flush_due(
            now + Duration::from_millis(699),
            &mut |payload| {
                emitted.push(payload.clone());
                Ok(())
            },
            &mut |_| {},
        );
        assert!(emitted.is_empty());

        dispatcher.flush_due(
            now + Duration::from_millis(700),
            &mut |payload| {
                emitted.push(payload.clone());
                Ok(())
            },
            &mut |_| {},
        );
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

        dispatcher.handle_message(
            WatchEventMessage::FileChanged(queued_event("notes/index.md", now, false, 1)),
            &mut |_| {},
        );

        assert!(emitted.is_empty());

        dispatcher.handle_message(
            WatchEventMessage::Attached(WatcherHealthEvent::healthy(1, "/tmp/project".to_string())),
            &mut |_| {},
        );
        dispatcher.flush_due(
            now + Duration::from_millis(499),
            &mut |payload| {
                emitted.push(payload.clone());
                Ok(())
            },
            &mut |_| {},
        );
        assert!(emitted.is_empty());

        dispatcher.flush_due(
            now + Duration::from_millis(500),
            &mut |payload| {
                emitted.push(payload.clone());
                Ok(())
            },
            &mut |_| {},
        );

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

        dispatcher.handle_message(
            WatchEventMessage::FileChanged(queued_event("notes/index.md", now, false, 1)),
            &mut |_| {},
        );
        dispatcher.handle_message(
            WatchEventMessage::FileChanged(queued_event(
                "notes/index.md",
                now + Duration::from_millis(200),
                false,
                2,
            )),
            &mut |_| {},
        );

        dispatcher.handle_message(
            WatchEventMessage::Attached(WatcherHealthEvent::healthy(1, "/tmp/project".to_string())),
            &mut |_| {},
        );
        dispatcher.flush_due(
            now + Duration::from_millis(700),
            &mut |payload| {
                emitted.push(payload.clone());
                Ok(())
            },
            &mut |_| {},
        );

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

        dispatcher.handle_message(
            WatchEventMessage::Attached(WatcherHealthEvent::healthy(1, "/tmp/project".to_string())),
            &mut |_| {},
        );
        dispatcher.handle_message(
            WatchEventMessage::FileChanged(queued_event("notes/index.md", now, true, 1)),
            &mut |_| {},
        );
        dispatcher.handle_message(
            WatchEventMessage::FileChanged(queued_event(
                "notes/index.md",
                now + Duration::from_millis(100),
                false,
                2,
            )),
            &mut |_| {},
        );

        dispatcher.flush_due(
            now + Duration::from_millis(600),
            &mut |payload| {
                emitted.push(payload.clone());
                Ok(())
            },
            &mut |_| {},
        );

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

        dispatcher.handle_message(
            WatchEventMessage::Attached(WatcherHealthEvent::healthy(1, "/tmp/project".to_string())),
            &mut |_| {},
        );
        dispatcher.handle_message(
            WatchEventMessage::FileChanged(queued_event("notes/index.md", now, false, 1)),
            &mut |_| {},
        );
        dispatcher.flush_due(
            now + Duration::from_millis(500),
            &mut |payload| {
                emitted.push(payload.clone());
                Ok(())
            },
            &mut |_| {},
        );

        dispatcher.handle_message(
            WatchEventMessage::FileChanged(queued_event(
                "notes/index.md",
                now + Duration::from_millis(750),
                false,
                2,
            )),
            &mut |_| {},
        );
        dispatcher.flush_due(
            now + Duration::from_millis(1250),
            &mut |payload| {
                emitted.push(payload.clone());
                Ok(())
            },
            &mut |_| {},
        );

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

    #[test]
    fn emits_degraded_health_when_file_change_emit_fails() {
        let now = Instant::now();
        let mut dispatcher = DebouncedEventDispatcher::new(Duration::from_millis(500));
        let mut health_events = Vec::new();

        dispatcher.handle_message(
            WatchEventMessage::Attached(WatcherHealthEvent::healthy(1, "/tmp/project".to_string())),
            &mut |_| {},
        );
        dispatcher.handle_message(
            WatchEventMessage::FileChanged(queued_event("notes/index.md", now, false, 1)),
            &mut |_| {},
        );

        dispatcher.flush_due(
            now + Duration::from_millis(500),
            &mut |_payload| Err("window closed".to_string()),
            &mut |payload| health_events.push(payload.clone()),
        );

        assert_eq!(health_events.len(), 1);
        assert_eq!(health_events[0].status, WatcherHealth::Degraded);
        assert_eq!(health_events[0].generation, 1);
        assert_eq!(health_events[0].root, "/tmp/project");
        assert!(
            health_events[0]
                .error
                .as_deref()
                .is_some_and(|error| { error.contains("window closed") })
        );
    }
}
