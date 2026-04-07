use tauri::{State, WebviewWindow, command};

use super::context::{CommandSpec, WindowCommandContext};
use super::state::{PerfState, ProjectRoot};
use crate::services::path as path_service;

const TO_PROJECT_RELATIVE_PATH: CommandSpec = CommandSpec::new(
    "tauri.to_project_relative_path",
    "tauri.path.to_project_relative_path",
    "tauri",
);

#[command]
pub fn to_project_relative_path(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<String, String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        TO_PROJECT_RELATIVE_PATH,
        Some(&path),
        |project_root| {
            path_service::project_relative_path(project_root, std::path::Path::new(&path))
        },
    )
}
