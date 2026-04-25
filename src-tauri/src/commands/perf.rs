use std::time::Instant;

use tauri::{State, WebviewWindow, command};

use super::context::run_window_command;
use super::state::{PerfSnapshot, PerfState};

const GET_PERF_SNAPSHOT: super::context::CommandSpec = super::context::CommandSpec::new(
    "tauri.get_perf_snapshot",
    "tauri.perf.get_perf_snapshot",
    "tauri",
);
const CLEAR_PERF_SNAPSHOT: super::context::CommandSpec = super::context::CommandSpec::new(
    "tauri.clear_perf_snapshot",
    "tauri.perf.clear_perf_snapshot",
    "tauri",
);

pub fn measure_command<T, F>(
    perf: &State<'_, PerfState>,
    operation_name: &str,
    span_name: &str,
    category: &str,
    detail: Option<&str>,
    task: F,
) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    let started_at = perf.inner().now_ms().unwrap_or(0.0);
    let started = Instant::now();
    let result = task();
    let duration_ms = started.elapsed().as_secs_f64() * 1000.0;
    let _ = perf.inner().record_span(
        span_name,
        category,
        duration_ms,
        Some(operation_name),
        detail,
    );
    let _ = perf
        .inner()
        .record_operation(operation_name, started_at, detail);
    result
}

#[command]
pub fn get_perf_snapshot(
    window: WebviewWindow,
    perf: State<'_, PerfState>,
) -> Result<PerfSnapshot, String> {
    run_window_command(&window, &perf, GET_PERF_SNAPSHOT, None, || {
        perf.inner().snapshot()
    })
}

#[command]
pub fn clear_perf_snapshot(
    window: WebviewWindow,
    perf: State<'_, PerfState>,
) -> Result<(), String> {
    run_window_command(&window, &perf, CLEAR_PERF_SNAPSHOT, None, || {
        perf.inner().clear()
    })
}
