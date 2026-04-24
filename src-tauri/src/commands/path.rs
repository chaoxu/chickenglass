use std::path::PathBuf;

use tauri::{command, State, WebviewWindow};

use super::context::{CommandSpec, WindowCommandContext};
use super::state::{PerfState, ProjectRoot};
use crate::services::path::{path_to_frontend_string, ProjectPathResolver};

const TO_PROJECT_RELATIVE_PATH: CommandSpec = CommandSpec::new(
    "tauri.to_project_relative_path",
    "tauri.path.to_project_relative_path",
    "tauri",
);
const CANONICALIZE_PROJECT_ROOT: CommandSpec = CommandSpec::new(
    "tauri.canonicalize_project_root",
    "tauri.path.canonicalize_project_root",
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
            let paths = ProjectPathResolver::new(project_root)?;
            paths.project_relative_path(std::path::Path::new(&path))
        },
    )
}

#[command]
pub fn canonicalize_project_root(
    perf: State<'_, PerfState>,
    path: String,
) -> Result<String, String> {
    super::context::run_command(&perf, CANONICALIZE_PROJECT_ROOT, Some(&path), || {
        canonicalize_project_root_path(&path)
    })
}

fn canonicalize_project_root_path(path: &str) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", path.display()));
    }
    let canonical = map_err_str!(path.canonicalize(), "Cannot resolve path: {}")?;
    path_to_frontend_string(&canonical, "Project root path")
}

#[cfg(test)]
mod tests {
    use super::canonicalize_project_root_path;
    use std::fs;
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
    fn canonicalize_project_root_path_returns_canonical_root() {
        let root = create_temp_dir("cmd-path-canonical");

        #[cfg(unix)]
        let alias = {
            let alias = root
                .parent()
                .expect("temp root should have parent")
                .join(format!(
                    "{}-alias",
                    root.file_name()
                        .and_then(|value| value.to_str())
                        .expect("temp root should be utf-8")
                ));
            let _ = fs::remove_file(&alias);
            let _ = fs::remove_dir_all(&alias);
            std::os::unix::fs::symlink(&root, &alias).expect("create symlink alias");
            alias
        };

        #[cfg(not(unix))]
        let alias = root.clone();

        let result = canonicalize_project_root_path(alias.to_str().expect("alias should be utf-8"))
            .expect("canonicalize project root");

        assert_eq!(result, root.to_str().expect("root should be utf-8"));

        #[cfg(unix)]
        {
            let _ = fs::remove_file(&alias);
            let _ = fs::remove_dir_all(&alias);
        }
        let _ = fs::remove_dir_all(&root);
    }
}
