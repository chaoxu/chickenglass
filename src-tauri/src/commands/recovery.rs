use tauri::{command, AppHandle, Manager, State};

use super::context::{run_command, CommandSpec};
use super::state::PerfState;
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
    perf: State<'_, PerfState>,
    project_root: String,
    path: String,
    name: String,
    content: String,
    baseline_hash: Option<String>,
) -> Result<HotExitBackupSummary, String> {
    let detail = path.clone();
    run_command(&perf, WRITE_HOT_EXIT_BACKUP, Some(&detail), || {
        let app_data_dir = app_data_dir(&app)?;
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
    })
}

#[command]
pub fn list_hot_exit_backups(
    app: AppHandle,
    perf: State<'_, PerfState>,
    project_root: String,
) -> Result<Vec<HotExitBackupSummary>, String> {
    run_command(&perf, LIST_HOT_EXIT_BACKUPS, Some(&project_root), || {
        let app_data_dir = app_data_dir(&app)?;
        recovery::list_hot_exit_backups(&app_data_dir, &project_root)
    })
}

#[command]
pub fn read_hot_exit_backup(
    app: AppHandle,
    perf: State<'_, PerfState>,
    project_root: String,
    path: String,
) -> Result<Option<HotExitBackup>, String> {
    run_command(&perf, READ_HOT_EXIT_BACKUP, Some(&path), || {
        let app_data_dir = app_data_dir(&app)?;
        recovery::read_hot_exit_backup(&app_data_dir, &project_root, &path)
    })
}

#[command]
pub fn delete_hot_exit_backup(
    app: AppHandle,
    perf: State<'_, PerfState>,
    project_root: String,
    path: String,
) -> Result<(), String> {
    run_command(&perf, DELETE_HOT_EXIT_BACKUP, Some(&path), || {
        let app_data_dir = app_data_dir(&app)?;
        recovery::delete_hot_exit_backup(&app_data_dir, &project_root, &path)
    })
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))
}
