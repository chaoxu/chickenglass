use std::path::Path;
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

/// Run a git command in `dir`, returning its trimmed stdout on success.
fn git_stdout(dir: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() { None } else { Some(text) }
}

/// Resolve the current branch or detached SHA for a git work tree.
///
/// Handles three HEAD states:
///   1. Normal branch — `rev-parse --abbrev-ref HEAD` returns the name.
///   2. Detached HEAD — `rev-parse --abbrev-ref HEAD` returns "HEAD";
///      we resolve a short SHA via `rev-parse --short HEAD`.
///   3. Unborn branch (freshly `git init`, no commits) —
///      `rev-parse --abbrev-ref HEAD` fails (exit 128); we fall back to
///      `symbolic-ref --short HEAD` which returns the default branch name.
pub fn resolve_branch(dir: &Path) -> Option<GitBranchInfo> {
    // Try the fast path: works for normal branches and detached HEAD.
    if let Some(name) = git_stdout(dir, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        if name == "HEAD" {
            // Detached HEAD — resolve to a short SHA.
            let sha = git_stdout(dir, &["rev-parse", "--short", "HEAD"])
                .unwrap_or_else(|| "HEAD".to_string());
            return Some(GitBranchInfo { branch: sha, is_detached: true });
        }
        return Some(GitBranchInfo { branch: name, is_detached: false });
    }

    // Unborn branch: HEAD exists as a symbolic ref but points to a ref that
    // doesn't exist yet.  `symbolic-ref --short HEAD` still returns the name.
    if let Some(name) = git_stdout(dir, &["symbolic-ref", "--short", "HEAD"]) {
        return Some(GitBranchInfo { branch: name, is_detached: false });
    }

    None
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
            if git_stdout(&project_root, &["rev-parse", "--is-inside-work-tree"]).is_none() {
                return Ok(None);
            }

            Ok(resolve_branch(&project_root))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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

    #[test]
    fn resolve_branch_returns_none_for_non_git_dir() {
        let dir = std::env::temp_dir().join("coflat-test-nongit");
        let _ = fs::create_dir_all(&dir);
        assert!(resolve_branch(&dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_branch_normal_repo() {
        let dir = std::env::temp_dir().join("coflat-test-normal");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Command::new("git").args(["init"]).current_dir(&dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status().unwrap();
        // Set a local identity so the commit succeeds on machines without
        // a global git user.name / user.email.
        Command::new("git").args(["config", "user.name", "test"])
            .current_dir(&dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status().unwrap();
        Command::new("git").args(["config", "user.email", "test@test"])
            .current_dir(&dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status().unwrap();
        let commit_ok = Command::new("git").args(["commit", "--allow-empty", "-m", "init"])
            .current_dir(&dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status().unwrap();
        assert!(commit_ok.success(), "initial commit must succeed for this test to be meaningful");

        let info = resolve_branch(&dir).expect("should resolve in a normal repo");
        assert!(!info.branch.is_empty());
        assert!(!info.is_detached);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_branch_detached_head() {
        let dir = std::env::temp_dir().join("coflat-test-detached");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Command::new("git").args(["init"]).current_dir(&dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status().unwrap();
        Command::new("git").args(["config", "user.name", "test"])
            .current_dir(&dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status().unwrap();
        Command::new("git").args(["config", "user.email", "test@test"])
            .current_dir(&dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status().unwrap();
        Command::new("git").args(["commit", "--allow-empty", "-m", "init"])
            .current_dir(&dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status().unwrap();
        Command::new("git").args(["checkout", "--detach", "HEAD"])
            .current_dir(&dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status().unwrap();

        let info = resolve_branch(&dir).expect("should resolve in a detached HEAD repo");
        assert!(!info.branch.is_empty(), "detached branch label should not be empty");
        assert!(info.is_detached, "should be marked as detached");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_branch_unborn_repo() {
        let dir = std::env::temp_dir().join("coflat-test-unborn");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Command::new("git").args(["init"]).current_dir(&dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status().unwrap();

        let info = resolve_branch(&dir).expect("should resolve in an unborn repo");
        // Default branch name is configured per-system (main/master/etc.),
        // but it must be non-empty and not detached.
        assert!(!info.branch.is_empty(), "branch should not be empty for unborn repo");
        assert!(!info.is_detached, "unborn branch should not be detached");
        let _ = fs::remove_dir_all(&dir);
    }
}
