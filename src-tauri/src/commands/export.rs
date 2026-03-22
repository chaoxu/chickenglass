use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use tauri::{State, command};

use super::perf::measure_command;
use super::state::PerfState;

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
#[command]
pub fn export_document(
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
            let output_path = PathBuf::from(&output_path);

            if let Some(parent) = output_path.parent() {
                if !parent.exists() {
                    return Err(format!("Output directory does not exist: {}", parent.display()));
                }
            }

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

            Ok(output_path.to_string_lossy().to_string())
        },
    )
}
