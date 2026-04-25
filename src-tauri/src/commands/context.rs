use std::path::{Path, PathBuf};

use tauri::{State, WebviewWindow};

use super::perf::measure_command;
use super::state::{PerfState, ProjectRoot};

const MAIN_WINDOW_LABEL: &str = "main";
const DOCUMENT_WINDOW_PREFIX: &str = "document-";

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
) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
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

pub fn run_window_command<T, F>(
    window: &WebviewWindow,
    perf: &State<'_, PerfState>,
    spec: CommandSpec,
    detail: Option<&str>,
    task: F,
) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    run_command(perf, spec, detail, || {
        ensure_trusted_window(window)?;
        task()
    })
}

pub fn ensure_trusted_window(window: &WebviewWindow) -> Result<(), String> {
    if is_trusted_window_label(window.label()) {
        Ok(())
    } else {
        Err(format!(
            "Command is not available to window '{}'",
            window.label()
        ))
    }
}

fn is_trusted_window_label(label: &str) -> bool {
    label == MAIN_WINDOW_LABEL
        || label
            .strip_prefix(DOCUMENT_WINDOW_PREFIX)
            .is_some_and(is_valid_document_window_suffix)
}

fn is_valid_document_window_suffix(suffix: &str) -> bool {
    !suffix.is_empty()
        && suffix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
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

    pub fn run<T, F>(&self, spec: CommandSpec, detail: Option<&str>, task: F) -> Result<T, String>
    where
        F: FnOnce(&Path) -> Result<T, String>,
    {
        run_command(self.perf, spec, detail, || {
            ensure_trusted_window(self.window)?;
            let project_root = self.project_root()?;
            task(project_root.as_path())
        })
    }

    pub fn project_root(&self) -> Result<PathBuf, String> {
        let lock = self.root.0.lock().map_err(|e| e.to_string())?;
        lock.get(self.window.label())
            .map(|entry| entry.path.clone())
            .ok_or("No project folder open".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::is_trusted_window_label;

    #[test]
    fn trusts_main_and_document_windows() {
        assert!(is_trusted_window_label("main"));
        assert!(is_trusted_window_label("document-1"));
        assert!(is_trusted_window_label("document-draft_2"));
    }

    #[test]
    fn rejects_unscoped_or_malformed_window_labels() {
        assert!(!is_trusted_window_label(""));
        assert!(!is_trusted_window_label("settings"));
        assert!(!is_trusted_window_label("document-"));
        assert!(!is_trusted_window_label("document-../main"));
    }
}
