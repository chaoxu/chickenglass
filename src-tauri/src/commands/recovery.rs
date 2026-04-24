use std::path::Path;

use tauri::{AppHandle, Manager, State, WebviewWindow, command};

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
    project_root: String,
    path: String,
    name: String,
    content: String,
    baseline_hash: Option<String>,
) -> Result<HotExitBackupSummary, String> {
    let detail = path.clone();
    WindowCommandContext::new(&window, &root, &perf).run(
        WRITE_HOT_EXIT_BACKUP,
        Some(&detail),
        |session_project_root| {
            let app_data_dir = app_data_dir(&app)?;
            let project_root = validated_project_root_key(session_project_root, &project_root)?;
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
    project_root: String,
) -> Result<Vec<HotExitBackupSummary>, String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        LIST_HOT_EXIT_BACKUPS,
        Some(&project_root),
        |session_project_root| {
            let app_data_dir = app_data_dir(&app)?;
            let project_root = validated_project_root_key(session_project_root, &project_root)?;
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
    project_root: String,
    path: String,
) -> Result<Option<HotExitBackup>, String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        READ_HOT_EXIT_BACKUP,
        Some(&path),
        |session_project_root| {
            let app_data_dir = app_data_dir(&app)?;
            let project_root = validated_project_root_key(session_project_root, &project_root)?;
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
    project_root: String,
    path: String,
) -> Result<(), String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        DELETE_HOT_EXIT_BACKUP,
        Some(&path),
        |session_project_root| {
            let app_data_dir = app_data_dir(&app)?;
            let project_root = validated_project_root_key(session_project_root, &project_root)?;
            recovery::delete_hot_exit_backup(&app_data_dir, &project_root, &path)
        },
    )
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))
}

fn validated_project_root_key(
    session_project_root: &Path,
    expected_project_root: &str,
) -> Result<String, String> {
    let session_project_root = path_to_frontend_string(session_project_root, "Project root path")?;
    if session_project_root != expected_project_root {
        return Err(format!(
            "Hot-exit backup project root mismatch: active project is '{}', request expected '{}'",
            session_project_root, expected_project_root,
        ));
    }
    Ok(session_project_root)
}

#[cfg(test)]
mod tests {
    use super::validated_project_root_key;
    use std::path::Path;

    #[test]
    fn validates_recovery_request_against_active_project_root() {
        let project_root = Path::new("/project-a");

        assert_eq!(
            validated_project_root_key(project_root, "/project-a").expect("matching root"),
            "/project-a",
        );

        let error = validated_project_root_key(project_root, "/project-b")
            .expect_err("stale recovery command should be rejected");
        assert!(error.contains("project root mismatch"), "got: {error}");
    }
}
