use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, MutexGuard};
use std::time::Instant;

use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct PerfOperationEntry {
    pub id: String,
    pub name: String,
    pub detail: Option<String>,
    pub started_at: f64,
    pub ended_at: f64,
    pub duration_ms: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
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

    use super::PerfState;

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
    fn perf_snapshot_serializes_with_frontend_camel_case_keys() {
        let perf = PerfState::new();

        let operation_started_at = perf.now_ms().expect("read perf clock");
        perf.record_span(
            "open_file.read",
            "open_file",
            12.5,
            Some("open_file"),
            Some("demo.md"),
        )
        .expect("record span");
        perf.record_operation("open_file", operation_started_at, Some("demo.md"))
            .expect("record operation");

        let snapshot = perf.snapshot().expect("snapshot");
        let json = serde_json::to_value(&snapshot).expect("serialize perf snapshot");
        let summary = &json["summaries"][0];
        let recent = &json["recent"][0];
        let operation = &json["operations"][0];

        assert!(json.get("summaries").is_some());
        assert!(summary.get("totalMs").is_some());
        assert!(summary.get("avgMs").is_some());
        assert!(summary.get("maxMs").is_some());
        assert!(summary.get("lastMs").is_some());
        assert!(summary.get("lastEndedAt").is_some());
        assert!(summary.get("total_ms").is_none());
        assert!(recent.get("durationMs").is_some());
        assert!(recent.get("startedAt").is_some());
        assert!(recent.get("endedAt").is_some());
        assert!(recent.get("operationName").is_some());
        assert!(recent.get("duration_ms").is_none());
        assert!(operation.get("startedAt").is_some());
        assert!(operation.get("endedAt").is_some());
        assert!(operation.get("durationMs").is_some());
        assert!(operation.get("duration_ms").is_none());
    }
}
