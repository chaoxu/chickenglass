use std::path::Path;
use std::process::Command;

use git2::{Repository, StatusOptions, StatusShow};
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

/// Resolve the current branch's configured upstream as `(remote, merge_ref)`.
///
/// Returns e.g. `("origin", "refs/heads/main")`.  Both `run_pull` and
/// `run_push` use this so they never rely on ambient `push.default` /
/// `pull.default` settings.
fn resolve_upstream(root: &Path) -> Result<(String, String), String> {
    let branch = get_branch_name(root)
        .ok_or("Not on a branch (detached HEAD)")?;

    let remote = git_config(root, &format!("branch.{branch}.remote"))
        .ok_or("No upstream remote configured for the current branch")?;
    let merge_ref = git_config(root, &format!("branch.{branch}.merge"))
        .ok_or("No upstream merge ref configured for the current branch")?;

    Ok((remote, merge_ref))
}

fn git_config(root: &Path, key: &str) -> Option<String> {
    let output = Command::new("git")
        .args(["config", key])
        .current_dir(root)
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() { None } else { Some(value) }
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
    let has_upstream = resolve_upstream(root).is_ok();
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
    let (remote, merge_ref) = resolve_upstream(root)?;
    let branch = merge_ref
        .strip_prefix("refs/heads/")
        .unwrap_or(&merge_ref);

    let output = Command::new("git")
        .args(["pull", "--ff-only", &remote, branch])
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
    let (remote, merge_ref) = resolve_upstream(root)?;

    // Push only HEAD to the exact upstream ref, ignoring push.default.
    let refspec = format!("HEAD:{merge_ref}");
    let output = Command::new("git")
        .args(["push", &remote, &refspec])
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

// ── File-level staging & commit (git2) ────────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    pub path: String,
    /// Index (staged) status: "added", "modified", "deleted", "renamed", "typechange"
    pub staged: Option<String>,
    /// Working-tree (unstaged) status: "modified", "deleted", "untracked", "renamed"
    pub unstaged: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub files: Vec<GitStatusEntry>,
}

fn open_repo(project_root: &Path) -> Result<Repository, String> {
    Repository::discover(project_root)
        .map_err(|e| format!("Not a git repository: {}", e))
}

/// Compute the project-root prefix relative to the repo working directory.
///
/// Returns `""` when the project root IS the repo root (the common case),
/// or something like `"docs/"` when the user opened a subdirectory.
/// All returned paths use forward slashes and end with `/` when non-empty.
fn workspace_prefix(repo: &Repository, project_root: &Path) -> Result<String, String> {
    let workdir = repo
        .workdir()
        .ok_or("Bare repositories are not supported")?;

    let canonical_workdir = workdir
        .canonicalize()
        .map_err(|e| format!("Cannot canonicalize repo workdir: {}", e))?;
    let canonical_project = project_root
        .canonicalize()
        .map_err(|e| format!("Cannot canonicalize project root: {}", e))?;

    let relative = canonical_project
        .strip_prefix(&canonical_workdir)
        .map_err(|_| "Project root is not inside the git repository".to_string())?;

    let prefix = relative.to_string_lossy().replace('\\', "/");
    if prefix.is_empty() {
        Ok(String::new())
    } else {
        Ok(format!("{}/", prefix))
    }
}

/// Convert a workspace-relative path to a repo-relative path by prepending
/// the workspace prefix.
fn to_repo_path(prefix: &str, workspace_path: &str) -> String {
    format!("{}{}", prefix, workspace_path)
}

fn get_repo_branch_name(repo: &Repository) -> Option<String> {
    let head = repo.head().ok()?;
    if head.is_branch() {
        head.shorthand().map(|s| s.to_string())
    } else {
        // Detached HEAD — show abbreviated OID
        head.target().map(|oid| format!("{:.7}", oid))
    }
}

fn status_flag_to_staged(flags: git2::Status) -> Option<&'static str> {
    if flags.intersects(git2::Status::INDEX_NEW) {
        Some("added")
    } else if flags.intersects(git2::Status::INDEX_MODIFIED) {
        Some("modified")
    } else if flags.intersects(git2::Status::INDEX_DELETED) {
        Some("deleted")
    } else if flags.intersects(git2::Status::INDEX_RENAMED) {
        Some("renamed")
    } else if flags.intersects(git2::Status::INDEX_TYPECHANGE) {
        Some("typechange")
    } else {
        None
    }
}

fn status_flag_to_unstaged(flags: git2::Status) -> Option<&'static str> {
    if flags.intersects(git2::Status::WT_NEW) {
        Some("untracked")
    } else if flags.intersects(git2::Status::WT_MODIFIED) {
        Some("modified")
    } else if flags.intersects(git2::Status::WT_DELETED) {
        Some("deleted")
    } else if flags.intersects(git2::Status::WT_RENAMED) {
        Some("renamed")
    } else {
        None
    }
}

/// Core logic for git status, extracted so it can be tested without Tauri state.
fn git_status_for_root(project_root: &Path) -> Result<GitStatusResult, String> {
    let repo = match open_repo(project_root) {
        Ok(r) => r,
        Err(_) => {
            return Ok(GitStatusResult {
                is_repo: false,
                branch: None,
                files: vec![],
            });
        }
    };

    let prefix = workspace_prefix(&repo, project_root)?;
    let branch = get_repo_branch_name(&repo);

    let mut opts = StatusOptions::new();
    opts.show(StatusShow::IndexAndWorkdir);
    opts.include_untracked(true);
    opts.recurse_untracked_dirs(true);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Failed to get git status: {}", e))?;

    let files: Vec<GitStatusEntry> = statuses
        .iter()
        .filter_map(|entry| {
            let path = entry.path()?.to_string();
            let flags = entry.status();
            if flags.is_empty() || flags.intersects(git2::Status::IGNORED) {
                return None;
            }

            // Filter to only files within the opened workspace.
            if !prefix.is_empty() && !path.starts_with(&prefix) {
                return None;
            }

            let staged = status_flag_to_staged(flags).map(String::from);
            let unstaged = status_flag_to_unstaged(flags).map(String::from);
            if staged.is_none() && unstaged.is_none() {
                return None;
            }

            // Strip workspace prefix so the frontend sees project-relative paths.
            let display_path = if prefix.is_empty() {
                path
            } else {
                path[prefix.len()..].to_string()
            };

            Some(GitStatusEntry {
                path: display_path,
                staged,
                unstaged,
            })
        })
        .collect();

    Ok(GitStatusResult {
        is_repo: true,
        branch,
        files,
    })
}

/// Query git working-tree status for the current project root.
///
/// Returns a map of project-relative paths to status strings:
/// - `"modified"`  -- tracked file with uncommitted changes
/// - `"added"`     -- new file staged in the index
/// - `"untracked"` -- file not tracked by git
///
/// Returns an empty map when the project root is not inside a git
/// repository, so non-git folders never break the file tree.
#[command]
pub fn git_status(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
) -> Result<GitStatusResult, String> {
    measure_command(
        &perf,
        "tauri.git_status",
        "tauri.git.status",
        "git",
        None,
        || {
            let project_root = current_project_root(&root, &window)?;
            git_status_for_root(&project_root)
        },
    )
}

/// Core logic for git stage, extracted so it can be tested without Tauri state.
fn git_stage_for_root(project_root: &Path, paths: &[String]) -> Result<(), String> {
    let repo = open_repo(project_root)?;
    let prefix = workspace_prefix(&repo, project_root)?;
    let workdir = repo
        .workdir()
        .ok_or("Bare repositories are not supported")?;

    let mut index = repo
        .index()
        .map_err(|e| format!("Failed to open index: {}", e))?;

    for ws_path in paths {
        let repo_path = to_repo_path(&prefix, ws_path);
        let abs_path = workdir.join(&repo_path);
        if abs_path.exists() {
            index
                .add_path(Path::new(&repo_path))
                .map_err(|e| format!("Failed to stage '{}': {}", ws_path, e))?;
        } else {
            // File was deleted in the working tree — stage the deletion
            index
                .remove_path(Path::new(&repo_path))
                .map_err(|e| format!("Failed to stage deletion '{}': {}", ws_path, e))?;
        }
    }

    index
        .write()
        .map_err(|e| format!("Failed to write index: {}", e))
}

#[command]
pub fn git_stage(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    paths: Vec<String>,
) -> Result<(), String> {
    measure_command(
        &perf,
        "tauri.git_stage",
        "tauri.git.stage",
        "git",
        None,
        || {
            let project_root = current_project_root(&root, &window)?;
            git_stage_for_root(&project_root, &paths)
        },
    )
}

/// Core logic for git unstage, extracted so it can be tested without Tauri state.
fn git_unstage_for_root(project_root: &Path, paths: &[String]) -> Result<(), String> {
    let repo = open_repo(project_root)?;
    let prefix = workspace_prefix(&repo, project_root)?;

    let head_commit = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok());

    // Convert workspace-relative paths to repo-relative paths.
    let repo_paths: Vec<String> = paths
        .iter()
        .map(|p| to_repo_path(&prefix, p))
        .collect();

    match head_commit {
        Some(commit) => {
            // Equivalent to `git reset HEAD -- <paths>`: resets index entries
            // to their HEAD version (or removes them if absent from HEAD).
            let path_strs: Vec<&str> = repo_paths.iter().map(|s| s.as_str()).collect();
            repo.reset_default(Some(commit.as_object()), path_strs.iter())
                .map_err(|e| format!("Failed to unstage: {}", e))
        }
        None => {
            // No HEAD (empty repo) — remove paths from index
            let mut index = repo
                .index()
                .map_err(|e| format!("Failed to open index: {}", e))?;
            for repo_path in &repo_paths {
                index
                    .remove_path(Path::new(repo_path))
                    .map_err(|e| format!("Failed to unstage '{}': {}", repo_path, e))?;
            }
            index
                .write()
                .map_err(|e| format!("Failed to write index: {}", e))
        }
    }
}

#[command]
pub fn git_unstage(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    paths: Vec<String>,
) -> Result<(), String> {
    measure_command(
        &perf,
        "tauri.git_unstage",
        "tauri.git.unstage",
        "git",
        None,
        || {
            let project_root = current_project_root(&root, &window)?;
            git_unstage_for_root(&project_root, &paths)
        },
    )
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub oid: String,
}

/// Core logic for git commit, extracted so it can be tested without Tauri state.
fn git_commit_for_root(project_root: &Path, message: &str) -> Result<GitCommitResult, String> {
    if message.trim().is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }

    let repo = open_repo(project_root)?;
    let prefix = workspace_prefix(&repo, project_root)?;

    // Check for staged changes and scope violations in a single pass.
    let mut opts = StatusOptions::new();
    opts.show(StatusShow::Index);
    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Failed to get git status: {}", e))?;

    let mut has_staged = false;
    let mut outside: Vec<String> = Vec::new();
    for entry in statuses.iter() {
        let flags = entry.status();
        if flags.is_empty() {
            continue;
        }
        let path = match entry.path() {
            Some(p) => p.to_string(),
            None => continue,
        };
        if !prefix.is_empty() && !path.starts_with(&prefix) {
            outside.push(path);
        } else {
            has_staged = true;
        }
    }

    if !has_staged {
        return Err("Nothing to commit — no staged changes".to_string());
    }

    if !outside.is_empty() {
        return Err(format!(
            "There are staged changes outside the current workspace ({}). \
             Open the repository root to commit, or unstage those files first.",
            outside.join(", ")
        ));
    }

    let sig = repo
        .signature()
        .map_err(|e| format!("No git identity configured (set user.name and user.email): {}", e))?;

    let mut index = repo
        .index()
        .map_err(|e| format!("Failed to open index: {}", e))?;

    let tree_oid = index
        .write_tree()
        .map_err(|e| format!("Failed to write tree: {}", e))?;
    let tree = repo
        .find_tree(tree_oid)
        .map_err(|e| format!("Failed to find tree: {}", e))?;

    let parent_commit = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok());

    let parents: Vec<&git2::Commit<'_>> = match &parent_commit {
        Some(c) => vec![c],
        None => vec![],
    };

    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .map_err(|e| format!("Commit failed: {}", e))?;

    Ok(GitCommitResult {
        oid: oid.to_string(),
    })
}

#[command]
pub fn git_commit(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    message: String,
) -> Result<GitCommitResult, String> {
    measure_command(
        &perf,
        "tauri.git_commit",
        "tauri.git.commit",
        "git",
        None,
        || {
            let project_root = current_project_root(&root, &window)?;
            git_commit_for_root(&project_root, &message)
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_temp_dir(prefix: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("coflat-git-{prefix}-{unique}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path.canonicalize().expect("canonicalize temp dir")
    }

    fn temp_dir(prefix: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("coflat-{prefix}-{unique}"));
        fs::create_dir_all(&path).unwrap();
        path.canonicalize().unwrap()
    }

    fn git(dir: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap();
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn init_git_repo(path: &Path) {
        git(path, &["init", "-b", "main"]);
        git(path, &["config", "user.email", "test@test.com"]);
        git(path, &["config", "user.name", "Test"]);
        fs::write(path.join("init.txt"), "init").unwrap();
        git(path, &["add", "."]);
        git(path, &["commit", "-m", "init"]);
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

    /// With push.default=matching a plain `git push` would push ALL branches
    /// that have a matching name on the remote.  run_push must push only
    /// HEAD to the current branch's configured upstream ref.
    #[test]
    fn push_with_matching_default_only_pushes_current_branch() {
        // Set up a bare "remote" inside an existing temp dir.
        let remote = temp_dir("push-match-remote");
        git(&remote, &["init", "--bare"]);

        // Clone it into a sibling directory.
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let clone = std::env::temp_dir().join(format!("coflat-push-match-clone-{unique}"));
        Command::new("git")
            .args(["clone"])
            .arg(&remote)
            .arg(&clone)
            .output()
            .unwrap();
        let clone = clone.canonicalize().unwrap();
        git(&clone, &["config", "user.email", "test@test.com"]);
        git(&clone, &["config", "user.name", "Test"]);

        // Initial commit + push to establish a main branch.
        fs::write(clone.join("init.txt"), "init").unwrap();
        git(&clone, &["add", "."]);
        git(&clone, &["commit", "-m", "init"]);
        let main_branch = git(&clone, &["rev-parse", "--abbrev-ref", "HEAD"]);
        git(&clone, &["push", "-u", "origin", &main_branch]);

        // Create a feature branch with its own upstream.
        git(&clone, &["checkout", "-b", "feature"]);
        fs::write(clone.join("feature.txt"), "feat").unwrap();
        git(&clone, &["add", "."]);
        git(&clone, &["commit", "-m", "feature base"]);
        git(&clone, &["push", "-u", "origin", "feature"]);

        // Go back to main and add a commit that should NOT be pushed.
        git(&clone, &["checkout", &main_branch]);
        fs::write(clone.join("main-extra.txt"), "extra").unwrap();
        git(&clone, &["add", "."]);
        git(&clone, &["commit", "-m", "main-only commit"]);

        // Set the dangerous config.
        git(&clone, &["config", "push.default", "matching"]);

        // Switch to feature, add a commit, and push via run_push.
        git(&clone, &["checkout", "feature"]);
        fs::write(clone.join("feature2.txt"), "feat2").unwrap();
        git(&clone, &["add", "."]);
        git(&clone, &["commit", "-m", "feature commit 2"]);

        let main_ref = format!("refs/heads/{main_branch}");
        let main_before = git(&remote, &["rev-parse", &main_ref]);
        let result = run_push(&clone);
        assert!(result.is_ok(), "push should succeed: {:?}", result);
        let main_after = git(&remote, &["rev-parse", &main_ref]);

        // main on the remote must be untouched.
        assert_eq!(
            main_before, main_after,
            "push must not move remote {main_branch} when checked out on feature"
        );

        // feature on the remote must match local HEAD.
        let remote_feature = git(&remote, &["rev-parse", "refs/heads/feature"]);
        let local_head = git(&clone, &["rev-parse", "HEAD"]);
        assert_eq!(remote_feature, local_head);

        fs::remove_dir_all(&remote).unwrap();
        fs::remove_dir_all(&clone).unwrap();
    }

    // ── Status / stage / commit tests ─────────────────────────────────────────

    /// Helper: init a git repo with an initial commit so HEAD exists.
    fn init_repo_with_commit(dir: &Path) -> Repository {
        let repo = Repository::init(dir).expect("init repo");

        // Configure a test identity.
        let mut config = repo.config().expect("repo config");
        config.set_str("user.name", "Test").expect("set user.name");
        config
            .set_str("user.email", "test@test.com")
            .expect("set user.email");

        // Create a file, stage it, and commit so HEAD exists.
        fs::write(dir.join(".gitkeep"), "").expect("write .gitkeep");
        {
            let mut index = repo.index().expect("index");
            index
                .add_path(Path::new(".gitkeep"))
                .expect("add .gitkeep");
            index.write().expect("write index");
            let tree_oid = index.write_tree().expect("write tree");
            let tree = repo.find_tree(tree_oid).expect("find tree");
            let sig = repo.signature().expect("signature");
            repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
                .expect("initial commit");
        }

        repo
    }

    #[test]
    fn git_status_entry_serializes_as_camel_case() {
        let entry = GitStatusEntry {
            path: "src/main.rs".to_string(),
            staged: Some("modified".to_string()),
            unstaged: None,
        };
        let json = serde_json::to_value(&entry).expect("serialize GitStatusEntry");
        assert_eq!(json["path"], "src/main.rs");
        assert_eq!(json["staged"], "modified");
        assert!(json["unstaged"].is_null());
        assert!(json.get("is_staged").is_none());
    }

    #[test]
    fn git_status_result_serializes_as_camel_case() {
        let result = GitStatusResult {
            is_repo: true,
            branch: Some("main".to_string()),
            files: vec![],
        };
        let json = serde_json::to_value(&result).expect("serialize GitStatusResult");
        assert_eq!(json["isRepo"], true);
        assert_eq!(json["branch"], "main");
        assert!(json.get("is_repo").is_none());
    }

    #[test]
    fn git_commit_result_serializes_as_camel_case() {
        let result = GitCommitResult {
            oid: "abc1234".to_string(),
        };
        let json = serde_json::to_value(&result).expect("serialize GitCommitResult");
        assert_eq!(json["oid"], "abc1234");
    }

    /// When the project root IS the repo root, all changed files appear with
    /// their original repo-relative paths and staging works normally.
    #[test]
    fn status_and_stage_at_repo_root() {
        let dir = create_temp_dir("git-root");
        init_repo_with_commit(&dir);

        // Create a modified file.
        fs::write(dir.join("file.txt"), "changed").expect("write file");

        let status = git_status_for_root(&dir).expect("status");
        assert!(status.is_repo);
        assert_eq!(status.files.len(), 1);
        assert_eq!(status.files[0].path, "file.txt");
        assert_eq!(status.files[0].unstaged.as_deref(), Some("untracked"));

        // Stage it.
        git_stage_for_root(&dir, &["file.txt".to_string()]).expect("stage");

        let status = git_status_for_root(&dir).expect("status after stage");
        assert_eq!(status.files.len(), 1);
        assert_eq!(status.files[0].staged.as_deref(), Some("added"));
        assert!(status.files[0].unstaged.is_none());

        // Unstage it.
        git_unstage_for_root(&dir, &["file.txt".to_string()]).expect("unstage");

        let status = git_status_for_root(&dir).expect("status after unstage");
        assert_eq!(status.files.len(), 1);
        assert!(status.files[0].staged.is_none());
        assert_eq!(status.files[0].unstaged.as_deref(), Some("untracked"));

        fs::remove_dir_all(&dir).unwrap();
    }

    /// When the user opens a subdirectory inside a larger repo, git_status
    /// must only return files within that subdirectory and paths must be
    /// relative to the opened directory, not the repo root.
    #[test]
    fn subdirectory_filters_and_normalizes_paths() {
        let dir = create_temp_dir("git-subdir");
        init_repo_with_commit(&dir);

        // Create files inside and outside the subdirectory.
        fs::create_dir_all(dir.join("docs")).expect("mkdir docs");
        fs::write(dir.join("docs/readme.md"), "hello").expect("write docs/readme.md");
        fs::write(dir.join("root-file.txt"), "top").expect("write root-file.txt");

        // Open the subdirectory as the project root.
        let subdir = dir.join("docs");

        let status = git_status_for_root(&subdir).expect("status from subdir");
        assert!(status.is_repo);

        // Only the file inside docs/ should appear, with its workspace-relative path.
        assert_eq!(status.files.len(), 1, "expected 1 file, got: {:?}", status.files);
        assert_eq!(status.files[0].path, "readme.md");
        assert_eq!(status.files[0].unstaged.as_deref(), Some("untracked"));

        // Stage using the workspace-relative path.
        git_stage_for_root(&subdir, &["readme.md".to_string()]).expect("stage from subdir");

        let status = git_status_for_root(&subdir).expect("status after stage");
        assert_eq!(status.files.len(), 1);
        assert_eq!(status.files[0].path, "readme.md");
        assert_eq!(status.files[0].staged.as_deref(), Some("added"));

        // Unstage.
        git_unstage_for_root(&subdir, &["readme.md".to_string()]).expect("unstage from subdir");

        let status = git_status_for_root(&subdir).expect("status after unstage");
        assert_eq!(status.files[0].staged, None);

        fs::remove_dir_all(&dir).unwrap();
    }

    /// Staging a file that was deleted in the working tree should stage the
    /// deletion rather than erroring.
    #[test]
    fn stage_deleted_file() {
        let dir = create_temp_dir("git-del");
        let repo = init_repo_with_commit(&dir);

        // Create and commit a file.
        let file_path = dir.join("to-delete.txt");
        fs::write(&file_path, "content").expect("write file");
        let mut index = repo.index().expect("index");
        index
            .add_path(Path::new("to-delete.txt"))
            .expect("add file");
        index.write().expect("write index");
        let tree_oid = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_oid).expect("find tree");
        let sig = repo.signature().expect("signature");
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "add file",
            &tree,
            &[&parent],
        )
        .expect("commit");

        // Delete the file from disk.
        fs::remove_file(&file_path).expect("delete file");

        // Stage the deletion.
        git_stage_for_root(&dir, &["to-delete.txt".to_string()]).expect("stage deletion");

        let status = git_status_for_root(&dir).expect("status after staging deletion");
        assert_eq!(status.files.len(), 1);
        assert_eq!(status.files[0].staged.as_deref(), Some("deleted"));

        fs::remove_dir_all(&dir).unwrap();
    }

    /// When the workspace is a subdirectory, committing must reject if there are
    /// staged files outside the workspace prefix.
    #[test]
    fn commit_rejects_staged_files_outside_workspace() {
        let dir = create_temp_dir("git-commit-scope");
        init_repo_with_commit(&dir);

        // Create files inside and outside the subdirectory.
        fs::create_dir_all(dir.join("docs")).expect("mkdir docs");
        fs::write(dir.join("docs/readme.md"), "hello").expect("write docs/readme.md");
        fs::write(dir.join("outside.txt"), "top").expect("write outside.txt");

        // Stage both files from the repo root.
        git_stage_for_root(&dir, &["docs/readme.md".to_string(), "outside.txt".to_string()])
            .expect("stage both");

        // Commit from the subdirectory workspace — should be rejected.
        let subdir = dir.join("docs");
        let result = git_commit_for_root(&subdir, "should fail");
        assert!(result.is_err(), "commit should be rejected when staged files exist outside workspace");
        let err = result.unwrap_err();
        assert!(
            err.contains("outside the current workspace"),
            "error should mention outside workspace, got: {err}"
        );

        // Unstage the outside file, then commit should succeed.
        git_unstage_for_root(&dir, &["outside.txt".to_string()]).expect("unstage outside");

        let result = git_commit_for_root(&subdir, "scoped commit");
        assert!(result.is_ok(), "commit should succeed with only workspace-scoped staged files");

        fs::remove_dir_all(&dir).unwrap();
    }

    /// Committing with no staged changes must be rejected rather than
    /// creating an empty commit.
    #[test]
    fn commit_rejects_empty_index() {
        let dir = create_temp_dir("git-empty-commit");
        init_repo_with_commit(&dir);

        // No changes — commit should fail.
        let result = git_commit_for_root(&dir, "empty commit");
        assert!(result.is_err(), "commit should be rejected with no staged changes");
        let err = result.unwrap_err();
        assert!(
            err.contains("no staged changes"),
            "error should mention no staged changes, got: {err}"
        );

        // Stage a real change — commit should succeed.
        fs::write(dir.join("new.txt"), "content").expect("write file");
        git_stage_for_root(&dir, &["new.txt".to_string()]).expect("stage");

        let result = git_commit_for_root(&dir, "real commit");
        assert!(result.is_ok(), "commit should succeed with staged changes");

        fs::remove_dir_all(&dir).unwrap();
    }

    /// Helper: commit all currently-staged changes.
    fn commit_staged(dir: &Path, message: &str) {
        let repo = Repository::open(dir).expect("open repo for commit");
        let mut index = repo.index().expect("index");
        let tree_oid = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_oid).expect("find tree");
        let sig = repo.signature().expect("signature");
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent])
            .expect("commit");
    }

    /// A staged rename from inside the workspace to outside must be rejected
    /// by the commit guard.
    #[test]
    fn rename_inside_to_outside_rejected_by_commit() {
        let dir = create_temp_dir("git-rename-out");
        init_repo_with_commit(&dir);

        // Commit a file inside docs/.
        fs::create_dir_all(dir.join("docs")).expect("mkdir docs");
        fs::write(dir.join("docs/readme.md"), "hello").expect("write");
        git_stage_for_root(&dir, &["docs/readme.md".to_string()]).expect("stage");
        commit_staged(&dir, "add doc");

        // Rename docs/readme.md → outside.txt in the working tree and index.
        fs::rename(dir.join("docs/readme.md"), dir.join("outside.txt")).expect("rename");
        {
            let repo = Repository::open(&dir).expect("open");
            let mut index = repo.index().expect("index");
            index.remove_path(Path::new("docs/readme.md")).expect("rm old");
            index.add_path(Path::new("outside.txt")).expect("add new");
            index.write().expect("write index");
        }

        let subdir = dir.join("docs");

        // Commit from docs/ must be rejected — outside.txt is out of scope.
        let result = git_commit_for_root(&subdir, "rename out");
        assert!(result.is_err(), "commit should reject inside->outside rename");
        let err = result.unwrap_err();
        assert!(
            err.contains("outside") || err.contains("no staged"),
            "error should mention scope violation, got: {err}"
        );

        fs::remove_dir_all(&dir).unwrap();
    }

    /// A staged rename from outside the workspace to inside must also be
    /// rejected by the commit guard.
    #[test]
    fn rename_outside_to_inside_rejected_by_commit() {
        let dir = create_temp_dir("git-rename-in");
        init_repo_with_commit(&dir);

        // Commit a file outside docs/.
        fs::write(dir.join("outside.txt"), "hello").expect("write");
        fs::create_dir_all(dir.join("docs")).expect("mkdir docs");
        git_stage_for_root(&dir, &["outside.txt".to_string()]).expect("stage");
        commit_staged(&dir, "add outside");

        // Rename outside.txt → docs/readme.md in the working tree and index.
        fs::rename(dir.join("outside.txt"), dir.join("docs/readme.md")).expect("rename");
        {
            let repo = Repository::open(&dir).expect("open");
            let mut index = repo.index().expect("index");
            index.remove_path(Path::new("outside.txt")).expect("rm old");
            index.add_path(Path::new("docs/readme.md")).expect("add new");
            index.write().expect("write index");
        }

        let subdir = dir.join("docs");

        // Commit from docs/ must be rejected — outside.txt deletion is out of scope.
        let result = git_commit_for_root(&subdir, "rename in");
        assert!(result.is_err(), "commit should reject outside->inside rename");
        let err = result.unwrap_err();
        assert!(
            err.contains("outside") || err.contains("no staged"),
            "error should mention scope violation, got: {err}"
        );

        fs::remove_dir_all(&dir).unwrap();
    }
}
