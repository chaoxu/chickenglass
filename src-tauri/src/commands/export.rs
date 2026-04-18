use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use tauri::{command, State, WebviewWindow};

use super::context::{run_command, CommandSpec, WindowCommandContext};
use super::state::{PerfState, ProjectRoot};
use crate::services::path::{project_relative_path, resolve_project_path};

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
        let output = Command::new("pandoc")
            .arg("--version")
            .output()
            .map_err(|e| format!("Failed to run pandoc: {}", e))?;

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
fn resolve_export_output_path(project_root: &Path, output_path: &str) -> Result<PathBuf, String> {
    let resolved_path = resolve_project_path(project_root, output_path)?;

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

fn resolve_export_source_dir(project_root: &Path, source_path: &str) -> Result<PathBuf, String> {
    let resolved_source_path = resolve_project_path(project_root, source_path)?;
    Ok(resolved_source_path
        .parent()
        .unwrap_or(project_root)
        .to_path_buf())
}

fn build_pandoc_resource_path(project_root: &Path, source_dir: &Path) -> Result<OsString, String> {
    let mut resource_paths = vec![source_dir.to_path_buf()];
    if source_dir != project_root {
        resource_paths.push(project_root.to_path_buf());
    }

    std::env::join_paths(resource_paths)
        .map_err(|e| format!("Failed to construct Pandoc resource path: {}", e))
}

#[command]
pub fn export_document(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    content: String,
    format: String,
    output_path: String,
    source_path: String,
) -> Result<String, String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        EXPORT_DOCUMENT,
        Some(&output_path),
        |project_root| {
            let output_path = resolve_export_output_path(&project_root, &output_path)?;
            let source_dir = resolve_export_source_dir(&project_root, &source_path)?;
            let resource_path = build_pandoc_resource_path(&project_root, &source_dir)?;

            let mut args = vec![
                "-f".to_string(),
                "markdown".to_string(),
                "--resource-path".to_string(),
                resource_path.to_string_lossy().to_string(),
                "-o".to_string(),
                output_path.to_string_lossy().to_string(),
            ];

            match format.as_str() {
                "pdf" => args.push("--pdf-engine=xelatex".to_string()),
                "latex" => {}
                _ => return Err(format!("Unsupported export format: {}", format)),
            }

            let mut child = Command::new("pandoc")
                .args(&args)
                .current_dir(&source_dir)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to start pandoc: {}", e))?;

            if let Some(ref mut stdin) = child.stdin {
                stdin
                    .write_all(content.as_bytes())
                    .map_err(|e| format!("Failed to write to pandoc stdin: {}", e))?;
            }

            let output = child
                .wait_with_output()
                .map_err(|e| format!("Failed to wait for pandoc: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Pandoc failed: {}", stderr));
            }

            project_relative_path(&project_root, &output_path)
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{
        build_pandoc_resource_path, resolve_export_output_path, resolve_export_source_dir,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn create_temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let counter = TEMP_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("coflat-{prefix}-{unique}-{counter}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path.canonicalize().expect("canonicalize temp dir")
    }

    #[test]
    fn resolves_relative_output_paths_within_project_root() {
        let project_root = create_temp_dir("export-root");
        let docs_dir = project_root.join("docs");
        fs::create_dir_all(&docs_dir).expect("create docs dir");

        let output_path =
            resolve_export_output_path(&project_root, "docs/out.pdf").expect("resolve output");

        assert_eq!(output_path, docs_dir.join("out.pdf"));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn rejects_relative_paths_that_escape_the_project_root() {
        let project_root = create_temp_dir("export-root");

        let error = resolve_export_output_path(&project_root, "../out.pdf")
            .expect_err("path traversal should fail");

        assert!(error.contains("escapes project root"));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn rejects_absolute_paths_outside_the_project_root() {
        let project_root = create_temp_dir("export-root");
        let outside_root = create_temp_dir("export-outside");
        let outside_path = outside_root.join("out.pdf");

        let error =
            resolve_export_output_path(&project_root, outside_path.to_str().expect("utf-8 path"))
                .expect_err("absolute path outside root should fail");

        assert!(error.contains("escapes project root"));

        fs::remove_dir_all(&project_root).expect("remove project root");
        fs::remove_dir_all(&outside_root).expect("remove outside root");
    }

    #[test]
    fn resolves_source_directory_from_the_document_path() {
        let project_root = create_temp_dir("export-root");
        let docs_dir = project_root.join("notes");
        fs::create_dir_all(&docs_dir).expect("create docs dir");

        let source_dir =
            resolve_export_source_dir(&project_root, "notes/main.md").expect("resolve source dir");

        assert_eq!(source_dir, docs_dir);

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn includes_document_dir_and_project_root_in_pandoc_resource_path() {
        let project_root = create_temp_dir("export-root");
        let docs_dir = project_root.join("notes");
        fs::create_dir_all(&docs_dir).expect("create docs dir");

        let resource_path =
            build_pandoc_resource_path(&project_root, &docs_dir).expect("resource path");
        let paths: Vec<PathBuf> = std::env::split_paths(&resource_path).collect();

        assert_eq!(paths, vec![docs_dir.clone(), project_root.clone()]);

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn avoids_duplicate_root_entries_in_pandoc_resource_path() {
        let project_root = create_temp_dir("export-root");

        let resource_path =
            build_pandoc_resource_path(&project_root, &project_root).expect("resource path");
        let paths: Vec<PathBuf> = std::env::split_paths(&resource_path).collect();

        assert_eq!(paths, vec![project_root.clone()]);

        fs::remove_dir_all(&project_root).expect("remove project root");
    }
}
