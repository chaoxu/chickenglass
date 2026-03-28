use std::path::Path;
use std::process::Command;

use serde::Serialize;
use tauri::{State, WebviewWindow, command};

use super::path::current_project_root;
use super::perf::measure_command;
use super::state::{PerfState, ProjectRoot};

// ── Existing branch-info types (used by get_git_branch) ──────────────────────

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
/// Each line looks like `  main` or `* feature-x`.
fn parse_branch_list(output: &str) -> Vec<GitBranchEntry> {
    output
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }
            let is_current = trimmed.starts_with("* ");
            let name = if is_current {
                trimmed.strip_prefix("* ").unwrap_or(trimmed)
            } else {
                trimmed
            };
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
    fn dirty_worktree_prefix_is_detectable() {
        // The frontend matches on this prefix to distinguish dirty-worktree
        // errors from hard failures.
        let err = format!("{}message", DIRTY_WORKTREE_PREFIX);
        assert!(err.starts_with("DIRTY_WORKTREE: "));
    }

    #[test]
    fn resolve_branch_name_unborn_repo() {
        let dir = std::env::temp_dir().join("coflat-test-unborn");
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
        let dir = std::env::temp_dir().join("coflat-test-nongit");
        let _ = std::fs::create_dir_all(&dir);
        assert!(resolve_branch_name(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
