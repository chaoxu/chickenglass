#!/usr/bin/env python3
"""
Deterministic issue orchestrator for Chickenglass.

Spawns Claude Code workers in isolated git worktrees, verifies isolation,
merges results in order, and pushes. No steps can be skipped — this is a
program, not a suggestion.

Usage:
    python scripts/run-issues.py 69 70 71          # specific issues
    python scripts/run-issues.py --all              # all open non-deferred issues
    python scripts/run-issues.py --dry-run 69 70    # plan without executing
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKTREE_DIR = REPO_ROOT / ".worktrees"
MAIN_BRANCH = "main"
DEFAULT_MAX_PARALLEL = 4
DEFERRED_LABEL = "deferred"
WORKER_TIMEOUT_SECONDS = 30 * 60  # 30 minutes per worker


@dataclass
class IssueTask:
    """A single issue to implement."""
    number: int
    title: str
    body: str
    branch: str = ""
    worktree: Path = Path()
    commit_sha: str = ""
    status: str = "pending"  # pending, running, done, failed, merged
    error: str = ""


@dataclass
class RunState:
    """State for the entire run."""
    tasks: list[IssueTask] = field(default_factory=list)
    merged_shas: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def run_cmd(
    args: list[str],
    cwd: Optional[Path] = None,
    check: bool = True,
    capture: bool = True,
    timeout: Optional[int] = None,
) -> subprocess.CompletedProcess[str]:
    """Run a command with proper error handling."""
    result = subprocess.run(
        args,
        cwd=cwd or REPO_ROOT,
        capture_output=capture,
        text=True,
        timeout=timeout,
    )
    if check and result.returncode != 0:
        stderr = result.stderr.strip() if result.stderr else ""
        raise RuntimeError(
            f"Command failed: {' '.join(args)}\n"
            f"Exit code: {result.returncode}\n"
            f"Stderr: {stderr}"
        )
    return result


def git(*args: str, cwd: Optional[Path] = None, check: bool = True) -> str:
    """Run a git command and return stdout."""
    result = run_cmd(["git", *args], cwd=cwd, check=check)
    return result.stdout.strip()


def log(msg: str, level: str = "INFO") -> None:
    """Print a timestamped log message."""
    ts = time.strftime("%H:%M:%S")
    symbol = {"INFO": ".", "OK": "+", "WARN": "!", "ERROR": "X", "RUN": ">"}
    print(f"  [{ts}] {symbol.get(level, '.')} {msg}", flush=True)


def log_header(msg: str) -> None:
    """Print a section header."""
    print(f"\n{'=' * 60}", flush=True)
    print(f"  {msg}", flush=True)
    print(f"{'=' * 60}", flush=True)


# ---------------------------------------------------------------------------
# Phase 1: Fetch issues
# ---------------------------------------------------------------------------

def fetch_issue(number: int) -> IssueTask:
    """Fetch a single issue from GitHub."""
    result = run_cmd([
        "gh", "issue", "view", str(number),
        "--json", "number,title,body",
    ])
    data = json.loads(result.stdout)
    return IssueTask(
        number=data["number"],
        title=data["title"],
        body=data.get("body", ""),
    )


def fetch_all_open_issues() -> list[IssueTask]:
    """Fetch all open non-deferred issues from GitHub."""
    result = run_cmd([
        "gh", "issue", "list",
        "--state", "open",
        "--json", "number,title,body,labels",
        "--limit", "50",
    ])
    issues = json.loads(result.stdout)
    tasks = []
    for i in issues:
        # Filter out deferred issues
        labels = {lbl.get("name", "") for lbl in i.get("labels", [])}
        if DEFERRED_LABEL in labels:
            log(f"Skipping #{i['number']}: {i['title']} (deferred)", "INFO")
            continue
        tasks.append(
            IssueTask(number=i["number"], title=i["title"], body=i.get("body", ""))
        )
    return tasks


# ---------------------------------------------------------------------------
# Phase 2: Preflight checks
# ---------------------------------------------------------------------------

def preflight() -> None:
    """Verify the repo is in a clean state before starting."""
    log_header("PREFLIGHT")

    # Check for uncommitted changes
    status = git("status", "--short")
    tracked_changes = [
        line for line in status.splitlines()
        if not line.startswith("??")
    ]
    if tracked_changes:
        log("Uncommitted tracked changes found:", "ERROR")
        for line in tracked_changes:
            log(f"  {line}", "ERROR")
        raise RuntimeError(
            "Cannot proceed with uncommitted changes. Commit or stash first."
        )
    log("Working tree is clean", "OK")

    # Verify on main branch
    branch = git("branch", "--show-current")
    if branch != MAIN_BRANCH:
        raise RuntimeError(
            f"Must be on '{MAIN_BRANCH}' branch, currently on '{branch}'"
        )
    log(f"On branch '{MAIN_BRANCH}'", "OK")

    # Pull latest
    git("pull", "--ff-only", "origin", MAIN_BRANCH, check=False)
    log("Pulled latest from origin", "OK")

    # Record baseline main SHA for isolation checking later
    global _baseline_main_sha
    _baseline_main_sha = git("rev-parse", "HEAD")
    log(f"Baseline main SHA: {_baseline_main_sha[:7]}", "OK")

    # Run typecheck
    log("Running typecheck...", "RUN")
    run_cmd(["npx", "tsc", "--noEmit"])
    log("Typecheck passed", "OK")

    # Run tests
    log("Running tests...", "RUN")
    run_cmd(["npm", "run", "test"])
    log("Tests passed", "OK")


_baseline_main_sha = ""


# ---------------------------------------------------------------------------
# Phase 3: Create worktrees and spawn workers
# ---------------------------------------------------------------------------

def create_worktree(task: IssueTask) -> None:
    """Create a git worktree for a task."""
    # Use flat directory name (no nested dirs)
    task.branch = f"feat/issue-{task.number}"
    task.worktree = WORKTREE_DIR / f"issue-{task.number}"

    # Clean up any existing worktree
    if task.worktree.exists():
        git("worktree", "remove", str(task.worktree), "--force", check=False)

    # Delete branch if it exists
    git("branch", "-D", task.branch, check=False)

    # Create fresh worktree
    git("worktree", "add", str(task.worktree), "-b", task.branch, MAIN_BRANCH)
    log(f"Created worktree: {task.worktree}", "OK")

    # Verify isolation
    actual_branch = git("branch", "--show-current", cwd=task.worktree)
    if actual_branch != task.branch:
        raise RuntimeError(
            f"Worktree branch mismatch: expected '{task.branch}', got '{actual_branch}'"
        )
    log(f"Isolation verified: branch is '{actual_branch}'", "OK")


def build_worker_prompt(task: IssueTask) -> str:
    """Build the prompt for a Claude worker."""
    return f"""You are working in an isolated git worktree.

CRITICAL ISOLATION RULES:
- Your worktree is at: {task.worktree}
- Your branch is: {task.branch}
- Before ANY git operation, run: git branch --show-current
- If it shows 'main', STOP IMMEDIATELY and exit with error.
- Do NOT cd to any other directory. Stay in your worktree.
- All file paths are relative to your worktree root.
- Run pwd before your first edit to confirm you are in the worktree.

TASK:
Implement GitHub issue #{task.number}: {task.title}

ISSUE BODY:
{task.body}

INSTRUCTIONS:
1. Read CLAUDE.md for project conventions.
2. Implement the feature described in the issue.
3. Write tests where appropriate.
4. Run verification:
   - npx tsc --noEmit (must pass)
   - npm run test (must pass)
5. Commit with conventional format:
   feat: {task.title}

   Closes #{task.number}

   Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>

6. Do NOT push. The orchestrator handles merging and pushing.
"""


def spawn_worker(task: IssueTask) -> subprocess.Popen[str]:
    """Spawn a Claude worker process for a task."""
    prompt = build_worker_prompt(task)
    task.status = "running"
    log(f"Spawning worker for #{task.number}: {task.title}", "RUN")

    # Pass prompt via stdin to avoid shell escaping issues with $, \, etc.
    proc = subprocess.Popen(
        [
            "claude",
            "--dir", str(task.worktree),
            "--print",
            "--dangerously-skip-permissions",
            "-",  # read prompt from stdin
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    # Write prompt to stdin and close it so claude starts processing
    if proc.stdin:
        proc.stdin.write(prompt)
        proc.stdin.close()
    return proc


# ---------------------------------------------------------------------------
# Phase 4: Wait for workers and verify
# ---------------------------------------------------------------------------

def check_main_not_contaminated() -> bool:
    """Check if main branch received unexpected commits (isolation escape)."""
    current_main_sha = git("rev-parse", MAIN_BRANCH)
    if current_main_sha != _baseline_main_sha:
        log(
            f"ISOLATION ESCAPE DETECTED: main moved from "
            f"{_baseline_main_sha[:7]} to {current_main_sha[:7]}",
            "ERROR",
        )
        return False
    return True


def verify_worker_result(task: IssueTask) -> None:
    """Verify a completed worker's output."""
    log(f"Verifying #{task.number}...", "RUN")

    # Check if main was contaminated by this worker
    if not check_main_not_contaminated():
        task.status = "failed"
        task.error = "ISOLATION ESCAPE: worker committed to main branch"
        log(task.error, "ERROR")
        # Reset main to baseline to recover
        git("checkout", MAIN_BRANCH)
        git("reset", "--hard", _baseline_main_sha)
        log(f"Reset main to baseline {_baseline_main_sha[:7]}", "WARN")
        return

    # Check the branch is correct
    actual_branch = git("branch", "--show-current", cwd=task.worktree)
    if actual_branch == MAIN_BRANCH:
        task.status = "failed"
        task.error = f"ISOLATION FAILURE: worker is on '{MAIN_BRANCH}'"
        log(task.error, "ERROR")
        return

    if actual_branch != task.branch:
        task.status = "failed"
        task.error = f"Branch mismatch: expected '{task.branch}', got '{actual_branch}'"
        log(task.error, "ERROR")
        return

    # Check for new commits
    main_sha = git("rev-parse", MAIN_BRANCH, cwd=task.worktree)
    head_sha = git("rev-parse", "HEAD", cwd=task.worktree)

    if head_sha == main_sha:
        # No new commits — check for uncommitted changes
        status = git("status", "--short", cwd=task.worktree)
        if status:
            task.status = "failed"
            task.error = "Worker left uncommitted changes"
            log(task.error, "WARN")
        else:
            task.status = "failed"
            task.error = "Worker produced no changes"
            log(task.error, "ERROR")
        return

    task.commit_sha = head_sha
    task.status = "done"
    log(f"#{task.number} done: {head_sha[:7]}", "OK")

    # Run typecheck in the worktree
    log(f"Typechecking #{task.number}...", "RUN")
    result = run_cmd(["npx", "tsc", "--noEmit"], cwd=task.worktree, check=False)
    if result.returncode != 0:
        task.status = "failed"
        task.error = f"Typecheck failed:\n{result.stderr[:500]}"
        log(f"#{task.number} typecheck failed", "ERROR")
        return
    log(f"#{task.number} typecheck passed", "OK")

    # Run tests in the worktree
    log(f"Testing #{task.number}...", "RUN")
    result = run_cmd(["npm", "run", "test"], cwd=task.worktree, check=False)
    if result.returncode != 0:
        task.status = "failed"
        task.error = f"Tests failed:\n{result.stderr[:500]}"
        log(f"#{task.number} tests failed", "ERROR")
        return
    log(f"#{task.number} tests passed", "OK")


# ---------------------------------------------------------------------------
# Phase 5: Merge
# ---------------------------------------------------------------------------

def merge_task(task: IssueTask, state: RunState) -> None:
    """Merge a completed task onto main via squash merge."""
    if task.status != "done":
        log(f"Skipping #{task.number} ({task.status})", "WARN")
        return

    log(f"Merging #{task.number}...", "RUN")

    # Ensure we're on main with clean state
    git("checkout", MAIN_BRANCH)
    git("reset", "--hard", "HEAD")  # clean any leftover state

    # Squash merge the task branch
    result = run_cmd(
        ["git", "merge", "--squash", task.branch],
        check=False,
    )

    if result.returncode != 0:
        # Check for any conflict markers in status
        status = git("status", "--short")
        conflict_files = [
            line for line in status.splitlines()
            if len(line) >= 2 and line[0] in "UDA" and line[1] in "UDA"
        ]
        if conflict_files:
            task.status = "failed"
            task.error = f"Merge conflicts in: {', '.join(f.split()[-1] for f in conflict_files)}"
            log(task.error, "ERROR")
            git("reset", "--hard", "HEAD")  # clean reset, not merge --abort
            return

    # Commit the merge
    commit_msg = (
        f"feat: {task.title}\n\n"
        f"Closes #{task.number}\n\n"
        f"Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
    )

    # Stage only tracked changes (not random untracked files)
    git("add", "-u")
    # Also add new files from the merge
    new_files = [
        line[3:] for line in git("status", "--short").splitlines()
        if line.startswith("?? src/") or line.startswith("?? tests/")
    ]
    for f in new_files:
        git("add", f)

    # Check if there are actually changes to commit
    diff = git("diff", "--cached", "--name-only")
    if not diff:
        log(f"#{task.number} had no changes to merge (already on main?)", "WARN")
        task.status = "merged"
        return

    git("commit", "-m", commit_msg)
    merged_sha = git("rev-parse", "HEAD")

    task.status = "merged"
    state.merged_shas.append(merged_sha)
    log(f"#{task.number} merged: {merged_sha[:7]}", "OK")

    # Post-merge typecheck
    log("Post-merge typecheck...", "RUN")
    result = run_cmd(["npx", "tsc", "--noEmit"], check=False)
    if result.returncode != 0:
        log(f"Post-merge typecheck FAILED for #{task.number}", "ERROR")
        log("Removing bad merge commit...", "WARN")
        git("reset", "--hard", "HEAD~1")  # clean removal, no revert commit
        task.status = "failed"
        task.error = "Post-merge typecheck failed — merge removed"
        return
    log("Post-merge typecheck passed", "OK")


# ---------------------------------------------------------------------------
# Phase 6: Push and cleanup
# ---------------------------------------------------------------------------

def push_and_cleanup(state: RunState) -> None:
    """Push merged changes and clean up worktrees."""
    log_header("PUSH & CLEANUP")

    merged = [t for t in state.tasks if t.status == "merged"]
    if not merged:
        log("Nothing to push — no tasks merged successfully", "WARN")
        cleanup_worktrees(state)
        return

    # Final test run
    log("Running final tests...", "RUN")
    result = run_cmd(["npm", "run", "test"], check=False)
    if result.returncode != 0:
        log("Final tests FAILED — not pushing", "ERROR")
        cleanup_worktrees(state)
        return
    log("Final tests passed", "OK")

    # Push
    log("Pushing to origin...", "RUN")
    git("push", "origin", MAIN_BRANCH)
    log(f"Pushed {len(merged)} features to origin/{MAIN_BRANCH}", "OK")

    cleanup_worktrees(state)


def cleanup_worktrees(state: RunState) -> None:
    """Remove all worktrees and their branches."""
    log("Cleaning up worktrees...", "RUN")
    # Must be on main, not inside a worktree
    git("checkout", MAIN_BRANCH, check=False)
    for task in state.tasks:
        if task.worktree.exists():
            git("worktree", "remove", str(task.worktree), "--force", check=False)
        if task.branch:
            git("branch", "-D", task.branch, check=False)
    # Remove the worktree directory if empty
    if WORKTREE_DIR.exists():
        try:
            WORKTREE_DIR.rmdir()
        except OSError:
            pass  # not empty, leave it
    log("Worktrees cleaned up", "OK")


# ---------------------------------------------------------------------------
# Phase 7: Report
# ---------------------------------------------------------------------------

def print_report(state: RunState, elapsed: float) -> None:
    """Print a summary report."""
    log_header("REPORT")

    merged = [t for t in state.tasks if t.status == "merged"]
    failed = [t for t in state.tasks if t.status == "failed"]

    for task in state.tasks:
        symbol = {
            "merged": "+",
            "done": "~",
            "failed": "X",
            "pending": "?",
            "running": ">",
        }.get(task.status, "?")
        line = f"  [{symbol}] #{task.number} {task.title}"
        if task.error:
            line += f" — {task.error}"
        print(line, flush=True)

    print(f"\n  Merged: {len(merged)}/{len(state.tasks)}", flush=True)
    if failed:
        print(f"  Failed: {len(failed)}/{len(state.tasks)}", flush=True)
    print(f"  Time:   {elapsed:.0f}s", flush=True)


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------

def run_batch(tasks: list[IssueTask], dry_run: bool = False, max_parallel: int = 4, worker_timeout: int = WORKER_TIMEOUT_SECONDS) -> RunState:
    """Run a batch of issues through the full pipeline."""
    state = RunState(tasks=tasks)

    # --- Phase 1: Display plan ---
    log_header(f"PLAN: {len(tasks)} issues")
    for task in tasks:
        log(f"#{task.number}: {task.title}")

    if dry_run:
        log("Dry run — stopping here", "WARN")
        return state

    # --- Phase 2: Preflight ---
    preflight()

    # --- Phase 3: Create worktrees ---
    log_header("CREATE WORKTREES")
    WORKTREE_DIR.mkdir(parents=True, exist_ok=True)
    for task in tasks:
        try:
            create_worktree(task)
        except RuntimeError as e:
            task.status = "failed"
            task.error = str(e)
            log(f"Failed to create worktree for #{task.number}: {e}", "ERROR")

    # --- Phase 4: Spawn workers (batched with timeout) ---
    log_header("SPAWN WORKERS")
    pending = [t for t in tasks if t.status == "pending"]
    active: dict[int, tuple[IssueTask, subprocess.Popen[str], float]] = {}

    while pending or active:
        # Spawn up to max_parallel
        while pending and len(active) < max_parallel:
            task = pending.pop(0)
            proc = spawn_worker(task)
            active[task.number] = (task, proc, time.time())

        # Wait for any to finish
        if active:
            time.sleep(2)
            finished = []
            now = time.time()
            for num, (task, proc, start_time) in active.items():
                elapsed = now - start_time

                # Check timeout
                if elapsed > worker_timeout:
                    log(f"#{num} TIMED OUT after {elapsed:.0f}s — killing", "ERROR")
                    proc.kill()
                    proc.wait()
                    task.status = "failed"
                    task.error = f"Timed out after {elapsed:.0f}s"
                    finished.append(num)
                    continue

                if proc.poll() is not None:
                    finished.append(num)
                    exit_code = proc.returncode
                    if exit_code != 0:
                        stderr = proc.stderr.read() if proc.stderr else ""
                        log(f"#{num} worker exited with code {exit_code}", "WARN")
                        if stderr:
                            log(f"  stderr: {stderr[:200]}", "WARN")
                    verify_worker_result(task)

            for num in finished:
                del active[num]

    # --- Phase 5: Merge in order ---
    log_header("MERGE")
    done_tasks = [t for t in tasks if t.status == "done"]
    for task in done_tasks:
        merge_task(task, state)

    # --- Phase 6: Push and cleanup ---
    push_and_cleanup(state)

    return state


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run Chickenglass issues through isolated Claude workers"
    )
    parser.add_argument(
        "issues",
        nargs="*",
        type=int,
        help="Issue numbers to implement",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Fetch and run all open non-deferred issues",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show plan without executing",
    )
    parser.add_argument(
        "--max-parallel",
        type=int,
        default=DEFAULT_MAX_PARALLEL,
        help=f"Max parallel workers (default: {DEFAULT_MAX_PARALLEL})",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=WORKER_TIMEOUT_SECONDS,
        help=f"Worker timeout in seconds (default: {WORKER_TIMEOUT_SECONDS})",
    )
    args = parser.parse_args()

    if not args.issues and not args.all:
        parser.error("Provide issue numbers or --all")

    worker_timeout = args.timeout

    # Fetch issues
    log_header("FETCH ISSUES")
    if args.all:
        tasks = fetch_all_open_issues()
        log(f"Found {len(tasks)} open non-deferred issues")
    else:
        tasks = []
        for num in args.issues:
            task = fetch_issue(num)
            tasks.append(task)
            log(f"Fetched #{task.number}: {task.title}")

    if not tasks:
        log("No issues to process", "WARN")
        return

    start = time.time()
    state = run_batch(tasks, dry_run=args.dry_run, max_parallel=args.max_parallel, worker_timeout=worker_timeout)
    elapsed = time.time() - start

    print_report(state, elapsed)

    # Exit with error if any tasks failed
    failed = [t for t in state.tasks if t.status == "failed"]
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
