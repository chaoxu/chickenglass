use std::time::Instant;

use tauri::{State, command};

use super::error::{AppError, AppResult};
use super::state::{PerfSnapshot, PerfState};

pub fn measure_command<T, F>(
    perf: &State<'_, PerfState>,
    operation_name: &str,
    span_name: &str,
    category: &str,
    detail: Option<&str>,
    task: F,
) -> AppResult<T>
where
    F: FnOnce() -> AppResult<T>,
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
pub fn get_perf_snapshot(perf: State<'_, PerfState>) -> AppResult<PerfSnapshot> {
    perf.inner().snapshot().map_err(AppError::native_error)
}

#[command]
pub fn clear_perf_snapshot(perf: State<'_, PerfState>) -> AppResult<()> {
    perf.inner().clear().map_err(AppError::native_error)
}
