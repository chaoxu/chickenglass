use std::path::Path;
use std::process::Command;

use serde::Serialize;
use tauri::{State, WebviewWindow, command};

use super::path::current_project_root;
use super::perf::measure_command;
use super::state::{PerfState, ProjectRoot};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
    pub branch: Option<String>,
    pub has_upstream: bool,
    pub ahead: u32,
    pub behind: u32,
}

// ── Internal helpers ──────────────────────────────────────────────────────────

fn get_branch_name(root: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(root)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() || branch == "HEAD" {
        None
    } else {
        Some(branch)
    }
}

fn check_upstream(root: &Path) -> bool {
    Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "@{upstream}"])
        .current_dir(root)
        .stderr(std::process::Stdio::null())
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn get_ahead_behind(root: &Path) -> (u32, u32) {
    let output = Command::new("git")
        .args(["rev-list", "--count", "--left-right", "HEAD...@{upstream}"])
        .current_dir(root)
        .stderr(std::process::Stdio::null())
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let text = String::from_utf8_lossy(&o.stdout);
            let parts: Vec<&str> = text.trim().split('\t').collect();
            if parts.len() == 2 {
                let ahead = parts[0].parse().unwrap_or(0);
                let behind = parts[1].parse().unwrap_or(0);
                (ahead, behind)
            } else {
                (0, 0)
            }
        }
        _ => (0, 0),
    }
}

pub fn build_branch_info(root: &Path) -> GitBranchInfo {
    let branch = get_branch_name(root);
    let has_upstream = check_upstream(root);
    let (ahead, behind) = if has_upstream {
        get_ahead_behind(root)
    } else {
        (0, 0)
    };
    GitBranchInfo {
        branch,
        has_upstream,
        ahead,
        behind,
    }
}

pub fn run_pull(root: &Path) -> Result<String, String> {
    let output = Command::new("git")
        .args(["pull", "--ff-only"])
        .current_dir(root)
        .output()
        .map_err(|e| format!("Failed to run git pull: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(stderr)
    }
}

pub fn run_push(root: &Path) -> Result<String, String> {
    let output = Command::new("git")
        .args(["push"])
        .current_dir(root)
        .output()
        .map_err(|e| format!("Failed to run git push: {}", e))?;

    if output.status.success() {
        // git push writes progress to stderr even on success
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(stderr)
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[command]
pub fn git_branch_info(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
) -> Result<GitBranchInfo, String> {
    measure_command(
        &perf,
        "tauri.git_branch_info",
        "tauri.git.branch_info",
        "tauri",
        None,
        || {
            let project_root = current_project_root(&root, &window)?;
            Ok(build_branch_info(&project_root))
        },
    )
}

#[command]
pub fn git_pull(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
) -> Result<String, String> {
    measure_command(
        &perf,
        "tauri.git_pull",
        "tauri.git.pull",
        "tauri",
        None,
        || {
            let project_root = current_project_root(&root, &window)?;
            run_pull(&project_root)
        },
    )
}

#[command]
pub fn git_push(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
) -> Result<String, String> {
    measure_command(
        &perf,
        "tauri.git_push",
        "tauri.git.push",
        "tauri",
        None,
        || {
            let project_root = current_project_root(&root, &window)?;
            run_push(&project_root)
        },
    )
}

// ── Branch-switch workflow ────────────────────────────────────────────────────

/// Prefix for dirty-worktree errors that the frontend can match on to
/// offer a confirmation dialog before retrying with `force = true`.
const DIRTY_WORKTREE_PREFIX: &str = "DIRTY_WORKTREE: ";

/// A local branch entry returned by `git_list_branches`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchEntry {
    pub name: String,
    pub is_current: bool,
}

/// Run a git command in the project root directory and return its stdout.
fn run_git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("git {} failed with exit code {}", args.join(" "), output.status)
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Parse `git branch --list` output into structured entries.
///
/// Each line is prefixed with a two-character marker:
///   `* ` = current branch
///   `+ ` = checked out in a linked worktree
///   `  ` = neither
fn parse_branch_list(output: &str) -> Vec<GitBranchEntry> {
    output
        .lines()
        .filter_map(|line| {
            if line.len() < 2 {
                return None;
            }
            let marker = &line[..2];
            let is_current = marker == "* ";
            let name = line[2..].trim();
            if name.is_empty() {
                return None;
            }
            // Skip detached HEAD indicators like `* (HEAD detached at abc1234)`.
            if name.starts_with('(') {
                return None;
            }
            Some(GitBranchEntry {
                name: name.to_string(),
                is_current,
            })
        })
        .collect()
}

/// Check whether the worktree has uncommitted changes.
fn has_dirty_worktree(root: &Path) -> Result<bool, String> {
    let output = run_git(root, &["status", "--porcelain"])?;
    Ok(!output.trim().is_empty())
}

/// If the worktree is dirty and `force` is false, return a prefixed error
/// that the frontend can detect to offer a confirmation retry.
fn guard_dirty(root: &Path, force: bool) -> Result<(), String> {
    if !force && has_dirty_worktree(root)? {
        return Err(format!(
            "{}You have uncommitted changes. Switching branches may overwrite them.",
            DIRTY_WORKTREE_PREFIX,
        ));
    }
    Ok(())
}

/// Resolve the current branch name.
///
/// Handles three HEAD states:
///   1. Normal branch — `rev-parse --abbrev-ref HEAD` returns the name.
///   2. Detached HEAD — `rev-parse --abbrev-ref HEAD` returns literal "HEAD".
///   3. Unborn branch (fresh `git init`, no commits) —
///      `rev-parse` fails; fall back to `symbolic-ref --short HEAD`.
fn resolve_branch_name(root: &std::path::Path) -> Option<String> {
    if let Ok(branch) = run_git(root, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        return Some(branch.trim().to_string());
    }
    // Unborn branch: HEAD is a symbolic ref pointing to a ref that
    // doesn't exist yet. symbolic-ref still returns the name.
    run_git(root, &["symbolic-ref", "--short", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
}

/// Return the name of the current branch, or `null` if the project is not
/// a git repository (or git is not installed).
#[command]
pub fn git_current_branch(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
) -> Result<Option<String>, String> {
    measure_command(
        &perf,
        "tauri.git_current_branch",
        "tauri.git.current_branch",
        "tauri",
        None,
        || {
            let project_root = current_project_root(&root, &window)?;
            Ok(resolve_branch_name(&project_root))
        },
    )
}

/// List all local branches.
#[command]
pub fn git_list_branches(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
) -> Result<Vec<GitBranchEntry>, String> {
    measure_command(
        &perf,
        "tauri.git_list_branches",
        "tauri.git.list_branches",
        "tauri",
        None,
        || {
            let project_root = current_project_root(&root, &window)?;
            let output = run_git(&project_root, &["branch", "--list"])?;
            Ok(parse_branch_list(&output))
        },
    )
}

/// Switch to an existing local branch.
///
/// When `force` is false and the worktree is dirty, returns a
/// `DIRTY_WORKTREE:` prefixed error so the frontend can prompt for
/// confirmation and retry with `force = true`.
#[command]
pub fn git_switch_branch(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    name: String,
    force: bool,
) -> Result<(), String> {
    measure_command(
        &perf,
        "tauri.git_switch_branch",
        "tauri.git.switch_branch",
        "tauri",
        Some(&name),
        || {
            let project_root = current_project_root(&root, &window)?;
            guard_dirty(&project_root, force)?;
            run_git(&project_root, &["checkout", &name])?;
            Ok(())
        },
    )
}

/// Create a new local branch and switch to it.
///
/// When `force` is false and the worktree is dirty, returns a
/// `DIRTY_WORKTREE:` prefixed error so the frontend can prompt for
/// confirmation and retry with `force = true`.
#[command]
pub fn git_create_branch(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    name: String,
    force: bool,
) -> Result<(), String> {
    measure_command(
        &perf,
        "tauri.git_create_branch",
        "tauri.git.create_branch",
        "tauri",
        Some(&name),
        || {
            let project_root = current_project_root(&root, &window)?;
            guard_dirty(&project_root, force)?;
            run_git(&project_root, &["checkout", "-b", &name])?;
            Ok(())
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("coflat-{prefix}-{unique}"));
        fs::create_dir_all(&path).unwrap();
        path.canonicalize().unwrap()
    }

    fn init_git_repo(path: &Path) {
        Command::new("git").args(["init"]).current_dir(path).output().unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(path)
            .output()
            .unwrap();
        fs::write(path.join("init.txt"), "init").unwrap();
        Command::new("git").args(["add", "."]).current_dir(path).output().unwrap();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(path)
            .output()
            .unwrap();
    }

    #[test]
    fn branch_info_in_git_repo() {
        let repo = temp_dir("git-info");
        init_git_repo(&repo);

        let info = build_branch_info(&repo);
        assert!(info.branch.is_some());
        assert!(!info.has_upstream);
        assert_eq!(info.ahead, 0);
        assert_eq!(info.behind, 0);

        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn branch_info_in_non_git_dir() {
        let dir = temp_dir("non-git");
        let info = build_branch_info(&dir);
        assert!(info.branch.is_none());
        assert!(!info.has_upstream);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn pull_in_non_git_dir_fails() {
        let dir = temp_dir("pull-fail");
        assert!(run_pull(&dir).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn push_in_non_git_dir_fails() {
        let dir = temp_dir("push-fail");
        assert!(run_push(&dir).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn parse_branch_list_basic() {
        let output = "  develop\n* main\n  feature-x\n";
        let branches = parse_branch_list(output);
        assert_eq!(branches.len(), 3);
        assert_eq!(branches[0].name, "develop");
        assert!(!branches[0].is_current);
        assert_eq!(branches[1].name, "main");
        assert!(branches[1].is_current);
        assert_eq!(branches[2].name, "feature-x");
        assert!(!branches[2].is_current);
    }

    #[test]
    fn parse_branch_list_empty() {
        let branches = parse_branch_list("");
        assert!(branches.is_empty());
    }

    #[test]
    fn parse_branch_list_skips_detached_head() {
        let output = "* (HEAD detached at abc1234)\n  main\n";
        let branches = parse_branch_list(output);
        assert_eq!(branches.len(), 1);
        assert_eq!(branches[0].name, "main");
    }

    #[test]
    fn parse_branch_list_single_current() {
        let output = "* main\n";
        let branches = parse_branch_list(output);
        assert_eq!(branches.len(), 1);
        assert_eq!(branches[0].name, "main");
        assert!(branches[0].is_current);
    }

    #[test]
    fn parse_branch_list_whitespace_lines() {
        let output = "\n  develop\n\n* main\n\n";
        let branches = parse_branch_list(output);
        assert_eq!(branches.len(), 2);
        assert_eq!(branches[0].name, "develop");
        assert_eq!(branches[1].name, "main");
    }

    #[test]
    fn parse_branch_list_linked_worktree() {
        // `+ ` marks branches checked out in linked worktrees.
        let output = "* feature\n+ main\n+ orc/issue-575\n  develop\n";
        let branches = parse_branch_list(output);
        assert_eq!(branches.len(), 4);
        assert_eq!(branches[0].name, "feature");
        assert!(branches[0].is_current);
        assert_eq!(branches[1].name, "main");
        assert!(!branches[1].is_current);
        assert_eq!(branches[2].name, "orc/issue-575");
        assert!(!branches[2].is_current);
        assert_eq!(branches[3].name, "develop");
        assert!(!branches[3].is_current);
    }

    #[test]
    fn dirty_worktree_prefix_is_detectable() {
        // The frontend matches on this prefix to distinguish dirty-worktree
        // errors from hard failures.
        let err = format!("{}message", DIRTY_WORKTREE_PREFIX);
        assert!(err.starts_with("DIRTY_WORKTREE: "));
    }

    #[test]
    fn resolve_branch_name_unborn_repo() {
        let dir = std::env::temp_dir().join("coflat-test-rbn-unborn");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Command::new("git")
            .args(["init"])
            .current_dir(&dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();

        let name = resolve_branch_name(&dir);
        assert!(name.is_some(), "should resolve in an unborn repo");
        assert!(!name.unwrap().is_empty(), "branch name should not be empty");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_branch_name_normal_repo() {
        let dir = std::env::temp_dir().join("coflat-test-branch-normal");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Command::new("git").args(["init"]).current_dir(&dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status().unwrap();
        Command::new("git").args(["config", "user.name", "test"]).current_dir(&dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status().unwrap();
        Command::new("git").args(["config", "user.email", "test@test"]).current_dir(&dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status().unwrap();
        Command::new("git").args(["commit", "--allow-empty", "-m", "init"]).current_dir(&dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status().unwrap();

        let name = resolve_branch_name(&dir);
        assert!(name.is_some(), "should resolve in a normal repo");
        assert!(!name.unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_branch_name_non_git_dir() {
        let dir = std::env::temp_dir().join("coflat-test-rbn-nongit");
        let _ = std::fs::create_dir_all(&dir);
        assert!(resolve_branch_name(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
