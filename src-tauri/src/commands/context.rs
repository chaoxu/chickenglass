use std::path::{Path, PathBuf};

use tauri::{State, WebviewWindow};

use super::error::{AppError, AppResult};
use super::perf::measure_command;
use super::state::{PerfState, ProjectRoot};

#[derive(Clone, Copy)]
pub struct CommandSpec {
    operation_name: &'static str,
    span_name: &'static str,
    category: &'static str,
}

impl CommandSpec {
    pub const fn new(
        operation_name: &'static str,
        span_name: &'static str,
        category: &'static str,
    ) -> Self {
        Self {
            operation_name,
            span_name,
            category,
        }
    }
}

pub fn run_command<T, F>(
    perf: &State<'_, PerfState>,
    spec: CommandSpec,
    detail: Option<&str>,
    task: F,
) -> AppResult<T>
where
    F: FnOnce() -> AppResult<T>,
{
    measure_command(
        perf,
        spec.operation_name,
        spec.span_name,
        spec.category,
        detail,
        task,
    )
}

pub struct WindowCommandContext<'a> {
    window: &'a WebviewWindow,
    root: &'a State<'a, ProjectRoot>,
    perf: &'a State<'a, PerfState>,
}

impl<'a> WindowCommandContext<'a> {
    pub fn new(
        window: &'a WebviewWindow,
        root: &'a State<'a, ProjectRoot>,
        perf: &'a State<'a, PerfState>,
    ) -> Self {
        Self { window, root, perf }
    }

    pub fn run<T, F>(&self, spec: CommandSpec, detail: Option<&str>, task: F) -> AppResult<T>
    where
        F: FnOnce(&Path) -> AppResult<T>,
    {
        run_command(self.perf, spec, detail, || {
            let project_root = self.project_root()?;
            task(project_root.as_path())
        })
    }

    pub fn project_root(&self) -> AppResult<PathBuf> {
        let lock = self
            .root
            .0
            .lock()
            .map_err(|e| AppError::native_error(e.to_string()))?;
        lock.get(self.window.label())
            .map(|entry| entry.path.clone())
            .ok_or_else(AppError::project_no_project)
    }
}
