use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use tauri::{State, WebviewWindow, command};

use super::path::{current_project_root, project_relative_path, resolve_project_path};
use super::perf::measure_command;
use super::state::{PerfState, ProjectRoot};

/// Check whether Pandoc is installed and return its version string.
#[command]
pub fn check_pandoc(perf: State<'_, PerfState>) -> Result<String, String> {
    measure_command(&perf, "tauri.check_pandoc", "tauri.export.check_pandoc", "tauri", None, || {
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
            return Err(format!("Output directory does not exist: {}", parent.display()));
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
    measure_command(
        &perf,
        "tauri.export_document",
        "tauri.export.export_document",
        "tauri",
        Some(&output_path),
        || {
            let project_root = current_project_root(&root, &window)?;
            let output_path = resolve_export_output_path(&project_root, &output_path)?;

            let mut args = vec![
                "-f".to_string(),
                "markdown".to_string(),
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
    use super::resolve_export_output_path;
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

        let error = resolve_export_output_path(
            &project_root,
            outside_path.to_str().expect("utf-8 path"),
        )
        .expect_err("absolute path outside root should fail");

        assert!(error.contains("escapes project root"));

        fs::remove_dir_all(&project_root).expect("remove project root");
        fs::remove_dir_all(&outside_root).expect("remove outside root");
    }
}
