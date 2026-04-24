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
            let project_root = session_project_root_key(session_project_root)?;
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
        |session_project_root| {
            let app_data_dir = app_data_dir(&app)?;
            let project_root = session_project_root_key(session_project_root)?;
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
        |session_project_root| {
            let app_data_dir = app_data_dir(&app)?;
            let project_root = session_project_root_key(session_project_root)?;
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
        |session_project_root| {
            let app_data_dir = app_data_dir(&app)?;
            let project_root = session_project_root_key(session_project_root)?;
            recovery::delete_hot_exit_backup(&app_data_dir, &project_root, &path)
        },
    )
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))
}

fn session_project_root_key(session_project_root: &std::path::Path) -> Result<String, String> {
    path_to_frontend_string(session_project_root, "Project root path")
}

#[cfg(test)]
mod tests {
    use super::session_project_root_key;
    use super::{HotExitBackupInput, recovery};
    use crate::commands::state::ProjectRootEntry;
    use std::collections::HashMap;
    use std::fs;
    use std::path::Path;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("coflat-{prefix}-{unique}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path.canonicalize().expect("canonicalize temp dir")
    }

    #[test]
    fn derives_recovery_project_key_from_active_project_root() {
        let project_root = Path::new("/project-a");

        assert_eq!(
            session_project_root_key(project_root).expect("matching root"),
            "/project-a",
        );
    }

    #[test]
    fn multi_window_recovery_uses_window_session_project_roots() {
        let app_data_dir = create_temp_dir("recovery-window-isolation");
        let project_roots = HashMap::from([
            (
                "main".to_string(),
                ProjectRootEntry {
                    generation: 1,
                    path: PathBuf::from("/project-a"),
                },
            ),
            (
                "secondary".to_string(),
                ProjectRootEntry {
                    generation: 1,
                    path: PathBuf::from("/project-b"),
                },
            ),
        ]);

        let main_project = session_project_root_key(&project_roots["main"].path)
            .expect("main project key");
        let secondary_project = session_project_root_key(&project_roots["secondary"].path)
            .expect("secondary project key");

        recovery::write_hot_exit_backup(
            &app_data_dir,
            HotExitBackupInput {
                project_root: main_project.clone(),
                path: "main.md".to_string(),
                name: "main.md".to_string(),
                content: "main draft".to_string(),
                baseline_hash: None,
            },
        )
        .expect("write main backup");
        recovery::write_hot_exit_backup(
            &app_data_dir,
            HotExitBackupInput {
                project_root: secondary_project.clone(),
                path: "main.md".to_string(),
                name: "main.md".to_string(),
                content: "secondary draft".to_string(),
                baseline_hash: None,
            },
        )
        .expect("write secondary backup");

        let main = recovery::read_hot_exit_backup(&app_data_dir, &main_project, "main.md")
            .expect("read main backup")
            .expect("main backup exists");
        let secondary =
            recovery::read_hot_exit_backup(&app_data_dir, &secondary_project, "main.md")
                .expect("read secondary backup")
                .expect("secondary backup exists");

        assert_eq!(main.content, "main draft");
        assert_eq!(secondary.content, "secondary draft");
        assert_ne!(main.project_key, secondary.project_key);

        let _ = fs::remove_dir_all(&app_data_dir);
    }
}
