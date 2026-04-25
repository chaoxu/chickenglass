use std::process::Command;

use tauri::{State, WebviewWindow, command};

use super::context::{CommandSpec, WindowCommandContext, run_window_command};
use super::state::{PerfState, ProjectRoot};
use crate::services::path::ProjectPathResolver;

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
pub fn open_url(
    window: WebviewWindow,
    perf: State<'_, PerfState>,
    url: String,
) -> Result<(), String> {
    run_window_command(&window, &perf, OPEN_URL, Some(&url), || {
        let lower = url.to_ascii_lowercase();
        if !lower.starts_with("http://") && !lower.starts_with("https://") {
            return Err(format!("Blocked non-http(s) URL: {}", url));
        }

        #[cfg(target_os = "macos")]
        {
            map_err_str!(
                Command::new("open").arg(&url).spawn(),
                "Failed to open URL: {}"
            )?;
        }

        #[cfg(target_os = "windows")]
        {
            map_err_str!(
                Command::new("cmd").args(["/C", "start", "", &url]).spawn(),
                "Failed to open URL: {}"
            )?;
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            map_err_str!(
                Command::new("xdg-open").arg(&url).spawn(),
                "Failed to open URL: {}"
            )?;
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
            let paths = ProjectPathResolver::new(project_root)?;
            let abs_path = paths.resolve_existing_path(&path)?;

            #[cfg(target_os = "macos")]
            {
                map_err_str!(
                    Command::new("open").arg("-R").arg(&abs_path).spawn(),
                    "Failed to reveal in Finder: {}"
                )?;
            }

            #[cfg(target_os = "windows")]
            {
                let mut select_arg = std::ffi::OsString::from("/select,");
                select_arg.push(&abs_path);
                map_err_str!(
                    Command::new("explorer").arg(select_arg).spawn(),
                    "Failed to reveal in Explorer: {}"
                )?;
            }

            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                let parent = abs_path.parent().unwrap_or(&abs_path);
                map_err_str!(
                    Command::new("xdg-open").arg(parent).spawn(),
                    "Failed to open file manager: {}"
                )?;
            }

            Ok(())
        },
    )
}
