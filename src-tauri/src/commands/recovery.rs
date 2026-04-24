use std::path::Path;

use tauri::{command, AppHandle, Manager, State, WebviewWindow};

use super::context::{CommandSpec, WindowCommandContext};
use super::state::{PerfState, ProjectRoot};
use crate::services::path::path_to_frontend_string;
use crate::services::recovery::{self, HotExitBackup, HotExitBackupInput, HotExitBackupSummary};

const WRITE_HOT_EXIT_BACKUP: CommandSpec = CommandSpec::new(
    "tauri.write_hot_exit_backup",
    "tauri.recovery.write_hot_exit_backup",
    "tauri",
);
const LIST_HOT_EXIT_BACKUPS: CommandSpec = CommandSpec::new(
    "tauri.list_hot_exit_backups",
    "tauri.recovery.list_hot_exit_backups",
    "tauri",
);
const READ_HOT_EXIT_BACKUP: CommandSpec = CommandSpec::new(
    "tauri.read_hot_exit_backup",
    "tauri.recovery.read_hot_exit_backup",
    "tauri",
);
const DELETE_HOT_EXIT_BACKUP: CommandSpec = CommandSpec::new(
    "tauri.delete_hot_exit_backup",
    "tauri.recovery.delete_hot_exit_backup",
    "tauri",
);

#[command]
pub fn write_hot_exit_backup(
    app: AppHandle,
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
    name: String,
    content: String,
    baseline_hash: Option<String>,
) -> Result<HotExitBackupSummary, String> {
    let detail = path.clone();
    WindowCommandContext::new(&window, &root, &perf).run(
        WRITE_HOT_EXIT_BACKUP,
        Some(&detail),
        |project_root| {
            let app_data_dir = app_data_dir(&app)?;
            let project_root = project_root_key(project_root)?;
            recovery::write_hot_exit_backup(
                &app_data_dir,
                HotExitBackupInput {
                    project_root,
                    path,
                    name,
                    content,
                    baseline_hash,
                },
            )
        },
    )
}

#[command]
pub fn list_hot_exit_backups(
    app: AppHandle,
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
) -> Result<Vec<HotExitBackupSummary>, String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        LIST_HOT_EXIT_BACKUPS,
        None,
        |project_root| {
            let app_data_dir = app_data_dir(&app)?;
            let project_root = project_root_key(project_root)?;
            recovery::list_hot_exit_backups(&app_data_dir, &project_root)
        },
    )
}

#[command]
pub fn read_hot_exit_backup(
    app: AppHandle,
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<Option<HotExitBackup>, String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        READ_HOT_EXIT_BACKUP,
        Some(&path),
        |project_root| {
            let app_data_dir = app_data_dir(&app)?;
            let project_root = project_root_key(project_root)?;
            recovery::read_hot_exit_backup(&app_data_dir, &project_root, &path)
        },
    )
}

#[command]
pub fn delete_hot_exit_backup(
    app: AppHandle,
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<(), String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        DELETE_HOT_EXIT_BACKUP,
        Some(&path),
        |project_root| {
            let app_data_dir = app_data_dir(&app)?;
            let project_root = project_root_key(project_root)?;
            recovery::delete_hot_exit_backup(&app_data_dir, &project_root, &path)
        },
    )
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))
}

fn project_root_key(project_root: &Path) -> Result<String, String> {
    path_to_frontend_string(project_root, "Project root path")
}
