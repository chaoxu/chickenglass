use std::process::Command;

use tauri::{State, WebviewWindow, command};

use super::perf::measure_command;
use super::path::{current_project_root, resolve_existing_path};
use super::state::{PerfState, ProjectRoot};

/// Reveal a file or directory in the OS file explorer.
#[command]
pub fn reveal_in_finder(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<(), String> {
    measure_command(
        &perf,
        "tauri.reveal_in_finder",
        "tauri.shell.reveal_in_finder",
        "tauri",
        Some(&path),
        || {
            let project_root = current_project_root(&root, &window)?;
            let abs_path = resolve_existing_path(&project_root, &path)?
                .to_string_lossy()
                .to_string();

            #[cfg(target_os = "macos")]
            {
                Command::new("open")
                    .args(["-R", &abs_path])
                    .spawn()
                    .map_err(|e| format!("Failed to reveal in Finder: {}", e))?;
            }

            #[cfg(target_os = "windows")]
            {
                Command::new("explorer")
                    .arg(format!("/select,{}", abs_path))
                    .spawn()
                    .map_err(|e| format!("Failed to reveal in Explorer: {}", e))?;
            }

            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                let path = std::path::PathBuf::from(&abs_path);
                let parent = path.parent().unwrap_or(&path);
                Command::new("xdg-open")
                    .arg(parent)
                    .spawn()
                    .map_err(|e| format!("Failed to open file manager: {}", e))?;
            }

            Ok(())
        },
    )
}
