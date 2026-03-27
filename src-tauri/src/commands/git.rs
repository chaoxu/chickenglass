use std::process::Command;

use serde::Serialize;
use tauri::{State, WebviewWindow, command};

use super::perf::measure_command;
use super::path::current_project_root;
use super::state::{PerfState, ProjectRoot};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
    /// Branch name, or short SHA when HEAD is detached.
    pub branch: String,
    /// `true` when HEAD is detached (not on any branch).
    pub is_detached: bool,
}

/// Return the current git branch for the open project, or `null` when the
/// project directory is not inside a git repository.
#[command]
pub fn get_git_branch(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
) -> Result<Option<GitBranchInfo>, String> {
    measure_command(
        &perf,
        "tauri.get_git_branch",
        "tauri.git.get_git_branch",
        "tauri",
        None,
        || {
            let project_root = current_project_root(&root, &window)?;

            // Quick check: is this directory inside a git work tree?
            let is_git = Command::new("git")
                .args(["rev-parse", "--is-inside-work-tree"])
                .current_dir(&project_root)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .output();

            match is_git {
                Ok(output) if output.status.success() => {}
                // Not a git repo — return None (no error).
                _ => return Ok(None),
            }

            // Get the symbolic branch name.  Returns "HEAD" when detached.
            let branch_output = Command::new("git")
                .args(["rev-parse", "--abbrev-ref", "HEAD"])
                .current_dir(&project_root)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .output()
                .map_err(|e| format!("Failed to get git branch: {}", e))?;

            if !branch_output.status.success() {
                return Ok(None);
            }

            let branch = String::from_utf8_lossy(&branch_output.stdout)
                .trim()
                .to_string();

            if branch == "HEAD" {
                // Detached HEAD — resolve to a short SHA instead.
                let sha_output = Command::new("git")
                    .args(["rev-parse", "--short", "HEAD"])
                    .current_dir(&project_root)
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .output()
                    .map_err(|e| format!("Failed to get git SHA: {}", e))?;

                let sha = String::from_utf8_lossy(&sha_output.stdout)
                    .trim()
                    .to_string();

                Ok(Some(GitBranchInfo {
                    branch: sha,
                    is_detached: true,
                }))
            } else {
                Ok(Some(GitBranchInfo {
                    branch,
                    is_detached: false,
                }))
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_branch_info_serializes_as_camel_case() {
        let info = GitBranchInfo {
            branch: "main".to_string(),
            is_detached: false,
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["branch"], "main");
        assert_eq!(json["isDetached"], false);
    }

    #[test]
    fn git_branch_info_serializes_detached() {
        let info = GitBranchInfo {
            branch: "abc1234".to_string(),
            is_detached: true,
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["branch"], "abc1234");
        assert_eq!(json["isDetached"], true);
    }
}
