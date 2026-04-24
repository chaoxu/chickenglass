use std::path::PathBuf;

use serde::Serialize;
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
const RESOLVE_PROJECT_FILE_TARGET: CommandSpec = CommandSpec::new(
    "tauri.resolve_project_file_target",
    "tauri.path.resolve_project_file_target",
    "tauri",
);
const PROJECT_CONFIG_FILE: &str = "coflat.yaml";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileTarget {
    pub project_root: String,
    pub relative_path: String,
}

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

#[command]
pub fn resolve_project_file_target(
    perf: State<'_, PerfState>,
    path: String,
) -> Result<ProjectFileTarget, String> {
    super::context::run_command(&perf, RESOLVE_PROJECT_FILE_TARGET, Some(&path), || {
        resolve_project_file_target_path(&path)
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

fn resolve_project_file_target_path(path: &str) -> Result<ProjectFileTarget, String> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err(format!("Not a file: {}", path.display()));
    }
    let canonical_file = map_err_str!(path.canonicalize(), "Cannot resolve path: {}")?;
    let file_parent = canonical_file
        .parent()
        .ok_or_else(|| format!("File path has no parent: {}", canonical_file.display()))?;
    let project_root = find_project_root_for_file_parent(file_parent);
    let relative_path = canonical_file
        .strip_prefix(&project_root)
        .map_err(|_| format!("Path '{}' escapes project root", canonical_file.display()))?;

    Ok(ProjectFileTarget {
        project_root: path_to_frontend_string(&project_root, "Project root path")?,
        relative_path: path_to_frontend_string(relative_path, "Project-relative path")?,
    })
}

fn find_project_root_for_file_parent(file_parent: &std::path::Path) -> PathBuf {
    for ancestor in file_parent.ancestors() {
        if ancestor.join(PROJECT_CONFIG_FILE).is_file() {
            return ancestor.to_path_buf();
        }
    }
    file_parent.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::{canonicalize_project_root_path, resolve_project_file_target_path};
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

    #[test]
    fn resolve_project_file_target_uses_nearest_project_config_root() {
        let root = create_temp_dir("cmd-project-file-root");
        fs::write(root.join("coflat.yaml"), "bibliography: refs.bib\n")
            .expect("write project config");
        let chapter_dir = root.join("chapters");
        fs::create_dir_all(&chapter_dir).expect("create chapter dir");
        let file = chapter_dir.join("intro.md");
        fs::write(&file, "# Intro").expect("write markdown file");

        let result = resolve_project_file_target_path(file.to_str().expect("file path utf-8"))
            .expect("resolve project file target");

        assert_eq!(result.project_root, root.to_str().expect("root path utf-8"));
        assert_eq!(result.relative_path, "chapters/intro.md");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_project_file_target_falls_back_to_file_parent_without_project_config() {
        let root = create_temp_dir("cmd-project-file-parent");
        let chapter_dir = root.join("chapters");
        fs::create_dir_all(&chapter_dir).expect("create chapter dir");
        let file = chapter_dir.join("intro.md");
        fs::write(&file, "# Intro").expect("write markdown file");

        let result = resolve_project_file_target_path(file.to_str().expect("file path utf-8"))
            .expect("resolve project file target");

        assert_eq!(
            result.project_root,
            chapter_dir.to_str().expect("chapter path utf-8")
        );
        assert_eq!(result.relative_path, "intro.md");

        let _ = fs::remove_dir_all(&root);
    }
}
