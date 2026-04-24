use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::Instant;

use notify::RecommendedWatcher;
use serde::Serialize;

/// Shared state holding the currently opened project directory.
pub struct ProjectRootEntry {
    pub generation: u64,
    pub path: PathBuf,
}

pub struct ProjectRoot(pub Mutex<HashMap<String, ProjectRootEntry>>);

/// Shared state holding the active file watcher (if any).
pub struct FileWatcherEntry {
    pub generation: u64,
    pub root: PathBuf,
    pub watcher: Option<RecommendedWatcher>,
}

pub struct FileWatcherState(pub Mutex<HashMap<String, FileWatcherEntry>>);

/// Shared state remembering the last webview window that held native focus.
pub struct LastFocusedWindow(pub Mutex<Option<String>>);

pub fn remove_window_native_state(
    window_label: &str,
    project_roots: &mut HashMap<String, ProjectRootEntry>,
    watchers: &mut HashMap<String, FileWatcherEntry>,
    last_focused_window: &mut Option<String>,
) {
    project_roots.remove(window_label);
    watchers.remove(window_label);
    if last_focused_window.as_deref() == Some(window_label) {
        *last_focused_window = None;
    }
}

#[derive(Serialize, Clone)]
pub struct PerfRecord {
    pub id: String,
    pub name: String,
    pub category: String,
    pub source: String,
    pub duration_ms: f64,
    pub started_at: f64,
    pub ended_at: f64,
    pub operation_name: Option<String>,
    pub detail: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct PerfSummaryEntry {
    pub name: String,
    pub category: String,
    pub source: String,
    pub count: u64,
    pub total_ms: f64,
    pub avg_ms: f64,
    pub max_ms: f64,
    pub last_ms: f64,
    pub last_ended_at: f64,
}

#[derive(Serialize, Clone)]
pub struct PerfOperationEntry {
    pub id: String,
    pub name: String,
    pub detail: Option<String>,
    pub started_at: f64,
    pub ended_at: f64,
    pub duration_ms: f64,
}

#[derive(Serialize, Clone)]
pub struct PerfSnapshot {
    pub summaries: Vec<PerfSummaryEntry>,
    pub recent: Vec<PerfRecord>,
    pub operations: Vec<PerfOperationEntry>,
}

struct PerfStore {
    start: Instant,
    next_id: u64,
    summaries: HashMap<String, PerfSummaryEntry>,
    recent: VecDeque<PerfRecord>,
    operations: VecDeque<PerfOperationEntry>,
}

impl PerfStore {
    fn new() -> Self {
        Self {
            start: Instant::now(),
            next_id: 0,
            summaries: HashMap::new(),
            recent: VecDeque::new(),
            operations: VecDeque::new(),
        }
    }

    fn next_record_id(&mut self, prefix: &str) -> String {
        self.next_id += 1;
        format!("{prefix}-{}", self.next_id)
    }

    fn now_ms(&self) -> f64 {
        self.start.elapsed().as_secs_f64() * 1000.0
    }

    fn record_span(
        &mut self,
        name: &str,
        category: &str,
        duration_ms: f64,
        operation_name: Option<&str>,
        detail: Option<&str>,
    ) {
        let ended_at = self.now_ms();
        let started_at = ended_at - duration_ms;
        let record = PerfRecord {
            id: self.next_record_id("perf"),
            name: name.to_string(),
            category: category.to_string(),
            source: "backend".to_string(),
            duration_ms,
            started_at,
            ended_at,
            operation_name: operation_name.map(|value| value.to_string()),
            detail: detail.map(|value| value.to_string()),
        };

        self.recent.push_front(record);
        while self.recent.len() > 200 {
            self.recent.pop_back();
        }

        let key = format!("backend:{category}:{name}");
        if let Some(summary) = self.summaries.get_mut(&key) {
            summary.count += 1;
            summary.total_ms += duration_ms;
            summary.avg_ms = summary.total_ms / summary.count as f64;
            summary.max_ms = summary.max_ms.max(duration_ms);
            summary.last_ms = duration_ms;
            summary.last_ended_at = ended_at;
        } else {
            self.summaries.insert(
                key,
                PerfSummaryEntry {
                    name: name.to_string(),
                    category: category.to_string(),
                    source: "backend".to_string(),
                    count: 1,
                    total_ms: duration_ms,
                    avg_ms: duration_ms,
                    max_ms: duration_ms,
                    last_ms: duration_ms,
                    last_ended_at: ended_at,
                },
            );
        }
    }

    fn record_operation(&mut self, name: &str, started_at: f64, detail: Option<&str>) {
        let ended_at = self.now_ms();
        let id = self.next_record_id("operation");
        self.operations.push_front(PerfOperationEntry {
            id,
            name: name.to_string(),
            detail: detail.map(|value| value.to_string()),
            started_at,
            ended_at,
            duration_ms: ended_at - started_at,
        });
        while self.operations.len() > 50 {
            self.operations.pop_back();
        }
    }

    fn snapshot(&self) -> PerfSnapshot {
        let mut summaries = self.summaries.values().cloned().collect::<Vec<_>>();
        summaries.sort_by(|a, b| {
            b.total_ms
                .partial_cmp(&a.total_ms)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        PerfSnapshot {
            summaries,
            recent: self.recent.iter().cloned().collect(),
            operations: self.operations.iter().cloned().collect(),
        }
    }

    fn clear(&mut self) {
        self.summaries.clear();
        self.recent.clear();
        self.operations.clear();
    }
}

pub struct PerfState(Mutex<PerfStore>);

impl PerfState {
    pub fn new() -> Self {
        Self(Mutex::new(PerfStore::new()))
    }

    fn lock_store(&self) -> MutexGuard<'_, PerfStore> {
        match self.0.lock() {
            Ok(store) => store,
            Err(poisoned) => {
                // Perf telemetry is best-effort; recover instead of permanently
                // disabling metrics after an unrelated panic while holding the lock.
                self.0.clear_poison();
                poisoned.into_inner()
            }
        }
    }

    pub fn now_ms(&self) -> Result<f64, String> {
        let store = self.lock_store();
        Ok(store.now_ms())
    }

    pub fn record_span(
        &self,
        name: &str,
        category: &str,
        duration_ms: f64,
        operation_name: Option<&str>,
        detail: Option<&str>,
    ) -> Result<(), String> {
        let mut store = self.lock_store();
        store.record_span(name, category, duration_ms, operation_name, detail);
        Ok(())
    }

    pub fn record_operation(
        &self,
        name: &str,
        started_at: f64,
        detail: Option<&str>,
    ) -> Result<(), String> {
        let mut store = self.lock_store();
        store.record_operation(name, started_at, detail);
        Ok(())
    }

    pub fn snapshot(&self) -> Result<PerfSnapshot, String> {
        let store = self.lock_store();
        Ok(store.snapshot())
    }

    pub fn clear(&self) -> Result<(), String> {
        let mut store = self.lock_store();
        store.clear();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::panic::{AssertUnwindSafe, catch_unwind};

    use super::{FileWatcherEntry, PerfState, ProjectRootEntry, remove_window_native_state};
    use std::collections::HashMap;
    use std::path::PathBuf;

    #[test]
    fn perf_state_recovers_after_mutex_poison() {
        let perf = PerfState::new();

        let panic_result = catch_unwind(AssertUnwindSafe(|| {
            let _guard = perf.0.lock().expect("lock perf store");
            panic!("poison perf store");
        }));
        assert!(panic_result.is_err(), "setup should poison the mutex");
        assert!(
            perf.0.lock().is_err(),
            "mutex should be poisoned before recovery"
        );

        perf.record_span("span", "category", 2.5, Some("operation"), Some("detail"))
            .expect("recover from poison and record");
        let snapshot = perf.snapshot().expect("snapshot after recovery");

        assert_eq!(snapshot.recent.len(), 1);
        assert_eq!(snapshot.recent[0].name, "span");
        assert!(
            perf.0.lock().is_ok(),
            "recovery should clear the poison flag"
        );
    }

    #[test]
    fn remove_window_native_state_clears_window_scoped_entries() {
        let mut project_roots = HashMap::from([
            (
                "main".to_string(),
                ProjectRootEntry {
                    generation: 1,
                    path: PathBuf::from("/tmp/main"),
                },
            ),
            (
                "other".to_string(),
                ProjectRootEntry {
                    generation: 1,
                    path: PathBuf::from("/tmp/other"),
                },
            ),
        ]);
        let mut watchers = HashMap::from([
            (
                "main".to_string(),
                FileWatcherEntry {
                    generation: 1,
                    root: PathBuf::from("/tmp/main"),
                    watcher: None,
                },
            ),
            (
                "other".to_string(),
                FileWatcherEntry {
                    generation: 1,
                    root: PathBuf::from("/tmp/other"),
                    watcher: None,
                },
            ),
        ]);
        let mut last_focused = Some("main".to_string());

        remove_window_native_state("main", &mut project_roots, &mut watchers, &mut last_focused);

        assert!(!project_roots.contains_key("main"));
        assert!(project_roots.contains_key("other"));
        assert!(!watchers.contains_key("main"));
        assert!(watchers.contains_key("other"));
        assert_eq!(last_focused, None);
    }
}
