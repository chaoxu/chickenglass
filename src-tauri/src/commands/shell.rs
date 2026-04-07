use std::process::Command;

use tauri::{State, WebviewWindow, command};

use super::context::{CommandSpec, WindowCommandContext, run_command};
use super::state::{PerfState, ProjectRoot};
use crate::services::path::resolve_existing_path;

const OPEN_URL: CommandSpec = CommandSpec::new("tauri.open_url", "tauri.shell.open_url", "tauri");
const REVEAL_IN_FINDER: CommandSpec = CommandSpec::new(
    "tauri.reveal_in_finder",
    "tauri.shell.reveal_in_finder",
    "tauri",
);

/// Open a URL in the OS default browser.
///
/// Only `http:` and `https:` URLs are allowed — all other schemes are rejected.
#[command]
pub fn open_url(perf: State<'_, PerfState>, url: String) -> Result<(), String> {
    run_command(&perf, OPEN_URL, Some(&url), || {
        let lower = url.to_ascii_lowercase();
        if !lower.starts_with("http://") && !lower.starts_with("https://") {
            return Err(format!("Blocked non-http(s) URL: {}", url));
        }

        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .arg(&url)
                .spawn()
                .map_err(|e| format!("Failed to open URL: {}", e))?;
        }

        #[cfg(target_os = "windows")]
        {
            Command::new("cmd")
                .args(["/C", "start", "", &url])
                .spawn()
                .map_err(|e| format!("Failed to open URL: {}", e))?;
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Command::new("xdg-open")
                .arg(&url)
                .spawn()
                .map_err(|e| format!("Failed to open URL: {}", e))?;
        }

        Ok(())
    })
}

/// Reveal a file or directory in the OS file explorer.
#[command]
pub fn reveal_in_finder(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    path: String,
) -> Result<(), String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        REVEAL_IN_FINDER,
        Some(&path),
        |project_root| {
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
