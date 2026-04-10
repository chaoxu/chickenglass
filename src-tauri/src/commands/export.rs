use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use tauri::{State, WebviewWindow, command};

use super::state::{PerfState, ProjectRoot};
use super::{
    context::{CommandSpec, WindowCommandContext, run_command},
    map_err_str,
};
use crate::services::path::ProjectPathResolver;

const CHECK_PANDOC: CommandSpec =
    CommandSpec::new("tauri.check_pandoc", "tauri.export.check_pandoc", "tauri");
const EXPORT_DOCUMENT: CommandSpec = CommandSpec::new(
    "tauri.export_document",
    "tauri.export.export_document",
    "tauri",
);

/// Check whether Pandoc is installed and return its version string.
#[command]
pub fn check_pandoc(perf: State<'_, PerfState>) -> Result<String, String> {
    run_command(&perf, CHECK_PANDOC, None, || {
        let output = map_err_str!(
            Command::new("pandoc").arg("--version").output(),
            "Failed to run pandoc: {}"
        )?;

        if !output.status.success() {
            return Err("pandoc --version returned a non-zero exit code".to_string());
        }

        let version = String::from_utf8_lossy(&output.stdout);
        Ok(version
            .lines()
            .next()
            .unwrap_or("pandoc (unknown version)")
            .to_string())
    })
}

/// Export a markdown document to PDF or LaTeX via Pandoc.
fn resolve_export_output_path(
    paths: &ProjectPathResolver,
    output_path: &str,
) -> Result<PathBuf, String> {
    let resolved_path = paths.resolve_project_path(output_path)?;

    if let Some(parent) = resolved_path.parent() {
        if !parent.exists() {
            return Err(format!(
                "Output directory does not exist: {}",
                parent.display()
            ));
        }
    }

    Ok(resolved_path)
}

#[command]
pub fn export_document(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    content: String,
    format: String,
    output_path: String,
) -> Result<String, String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        EXPORT_DOCUMENT,
        Some(&output_path),
        |project_root| {
            let paths = ProjectPathResolver::new(project_root)?;
            let output_path = resolve_export_output_path(&paths, &output_path)?;

            let mut command = Command::new("pandoc");
            command
                .arg("-f")
                .arg("markdown")
                .arg("-o")
                .arg(&output_path);

            match format.as_str() {
                "pdf" => {
                    command.arg("--pdf-engine=xelatex");
                }
                "latex" => {}
                _ => return Err(format!("Unsupported export format: {}", format)),
            }

            let mut child = map_err_str!(
                command
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn(),
                "Failed to start pandoc: {}"
            )?;

            if let Some(ref mut stdin) = child.stdin {
                map_err_str!(
                    stdin.write_all(content.as_bytes()),
                    "Failed to write to pandoc stdin: {}"
                )?;
            }

            let output = map_err_str!(child.wait_with_output(), "Failed to wait for pandoc: {}")?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Pandoc failed: {}", stderr));
            }

            paths.project_relative_path(&output_path)
        },
    )
}

#[cfg(test)]
mod tests {
    use super::resolve_export_output_path;
    use crate::services::path::ProjectPathResolver;
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
    fn resolves_relative_output_paths_within_project_root() {
        let project_root = create_temp_dir("export-root");
        let docs_dir = project_root.join("docs");
        fs::create_dir_all(&docs_dir).expect("create docs dir");
        let paths = ProjectPathResolver::new(&project_root).expect("build path resolver");

        let output_path =
            resolve_export_output_path(&paths, "docs/out.pdf").expect("resolve output");

        assert_eq!(output_path, docs_dir.join("out.pdf"));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn rejects_relative_paths_that_escape_the_project_root() {
        let project_root = create_temp_dir("export-root");
        let paths = ProjectPathResolver::new(&project_root).expect("build path resolver");

        let error = resolve_export_output_path(&paths, "../out.pdf")
            .expect_err("path traversal should fail");

        assert!(error.contains("escapes project root"));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn rejects_absolute_paths_outside_the_project_root() {
        let project_root = create_temp_dir("export-root");
        let outside_root = create_temp_dir("export-outside");
        let outside_path = outside_root.join("out.pdf");
        let paths = ProjectPathResolver::new(&project_root).expect("build path resolver");

        let error = resolve_export_output_path(&paths, outside_path.to_str().expect("utf-8 path"))
            .expect_err("absolute path outside root should fail");

        assert!(error.contains("escapes project root"));

        fs::remove_dir_all(&project_root).expect("remove project root");
        fs::remove_dir_all(&outside_root).expect("remove outside root");
    }
}
