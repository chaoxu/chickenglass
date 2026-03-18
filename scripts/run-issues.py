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
    python scripts/run-issues.py --no-push --all    # run but don't push (inspect first)
"""

from __future__ import annotations

import argparse
import json
import signal
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
MAX_PARALLEL_CAP = 8
DEFERRED_LABEL = "deferred"
DEFAULT_WORKER_TIMEOUT = 30 * 60  # 30 minutes per worker
STALL_THRESHOLD_SECONDS = 5 * 60  # warn if no output growth for 5 minutes
LOG_DIR = REPO_ROOT / ".worktrees" / "logs"


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
    log_file: Path = Path()
    last_output_size: int = 0
    last_output_time: float = 0.0


@dataclass
class RunState:
    """State for the entire run."""
    tasks: list[IssueTask] = field(default_factory=list)
    merged_shas: list[str] = field(default_factory=list)
    baseline_main_sha: str = ""


# Active worker processes — global for signal handler cleanup
_active_procs: list[subprocess.Popen[str]] = []
_current_state: Optional[RunState] = None


# ---------------------------------------------------------------------------
# Signal handling
# ---------------------------------------------------------------------------

def _shutdown_handler(signum: int, _frame: object) -> None:
    """Kill all active workers and clean up on Ctrl+C or SIGTERM."""
    sig_name = signal.Signals(signum).name
    print(f"\n  [!] Received {sig_name} — shutting down...", flush=True)

    # Kill all active worker processes
    for proc in _active_procs:
        try:
            proc.kill()
        except OSError:
            pass
    for proc in _active_procs:
        try:
            proc.wait(timeout=5)
        except (subprocess.TimeoutExpired, OSError):
            pass
    _active_procs.clear()

    # Clean up worktrees if state exists
    if _current_state:
        print("  [!] Cleaning up worktrees...", flush=True)
        cleanup_worktrees(_current_state)

    # Reset git to clean state
    try:
        subprocess.run(
            ["git", "merge", "--abort"],
            cwd=REPO_ROOT, capture_output=True, check=False,
        )
        subprocess.run(
            ["git", "checkout", MAIN_BRANCH],
            cwd=REPO_ROOT, capture_output=True, check=False,
        )
        subprocess.run(
            ["git", "reset", "--hard", "HEAD"],
            cwd=REPO_ROOT, capture_output=True, check=False,
        )
    except OSError:
        pass

    print("  [!] Shutdown complete.", flush=True)
    sys.exit(130)


signal.signal(signal.SIGINT, _shutdown_handler)
signal.signal(signal.SIGTERM, _shutdown_handler)


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
    try:
        result = subprocess.run(
            args,
            cwd=cwd or REPO_ROOT,
            capture_output=capture,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError:
        cmd = args[0] if args else "unknown"
        raise RuntimeError(
            f"Command not found: '{cmd}'. Is it installed and on PATH?"
        ) from None
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

def preflight(state: RunState) -> None:
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
    state.baseline_main_sha = git("rev-parse", "HEAD")
    log(f"Baseline main SHA: {state.baseline_main_sha[:7]}", "OK")

    # Run typecheck
    log("Running typecheck...", "RUN")
    run_cmd(["npx", "tsc", "--noEmit"])
    log("Typecheck passed", "OK")

    # Run tests
    log("Running tests...", "RUN")
    run_cmd(["npm", "run", "test"])
    log("Tests passed", "OK")


# ---------------------------------------------------------------------------
# Phase 3: Create worktrees and spawn workers
# ---------------------------------------------------------------------------

def create_worktree(task: IssueTask) -> None:
    """Create a git worktree for a task."""
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
    task.last_output_time = time.time()

    # Create log file for this worker
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    task.log_file = LOG_DIR / f"worker-{task.number}.log"
    log_fh = open(task.log_file, "w")

    log(f"Spawning worker for #{task.number}: {task.title}", "RUN")
    log(f"  Log: {task.log_file}", "INFO")

    # Use cwd to set the working directory — NOT --dir flag
    proc = subprocess.Popen(
        [
            "claude",
            "--print",
            "--dangerously-skip-permissions",
            "-p", prompt,
        ],
        cwd=task.worktree,
        stdout=log_fh,
        stderr=subprocess.PIPE,
        text=True,
    )
    _active_procs.append(proc)
    return proc


# ---------------------------------------------------------------------------
# Phase 4: Wait for workers and verify
# ---------------------------------------------------------------------------

def print_worker_status(
    active: dict[int, tuple[IssueTask, subprocess.Popen[str], float]],
    now: float,
) -> None:
    """Print a one-line status for each active worker."""
    lines = []
    for num, (task, _proc, start_time) in sorted(active.items()):
        elapsed = now - start_time
        mins, secs = divmod(int(elapsed), 60)

        # Check log file size for progress
        output_size = 0
        if task.log_file.exists():
            output_size = task.log_file.stat().st_size

        size_kb = output_size / 1024
        stalled = ""
        if output_size > task.last_output_size:
            task.last_output_size = output_size
            task.last_output_time = now
        elif now - task.last_output_time > STALL_THRESHOLD_SECONDS:
            stall_mins = int((now - task.last_output_time) / 60)
            stalled = f" STALLED {stall_mins}m!"

        lines.append(f"#{num} {mins}m{secs:02d}s {size_kb:.1f}KB{stalled}")

    if lines:
        log("  ".join(lines), "RUN")


def check_main_not_contaminated(state: RunState) -> bool:
    """Check if main branch received unexpected commits (isolation escape)."""
    if not state.baseline_main_sha:
        log("No baseline SHA — cannot check contamination", "WARN")
        return True  # can't check, assume OK
    current_main_sha = git("rev-parse", MAIN_BRANCH)
    if current_main_sha != state.baseline_main_sha:
        log(
            f"ISOLATION ESCAPE DETECTED: main moved from "
            f"{state.baseline_main_sha[:7]} to {current_main_sha[:7]}",
            "ERROR",
        )
        return False
    return True


def verify_worker_result(task: IssueTask, state: RunState) -> None:
    """Verify a completed worker's output."""
    log(f"Verifying #{task.number}...", "RUN")

    # Check if main was contaminated by this worker
    if not check_main_not_contaminated(state):
        task.status = "failed"
        task.error = "ISOLATION ESCAPE: worker committed to main branch"
        log(task.error, "ERROR")
        git("checkout", MAIN_BRANCH)
        git("reset", "--hard", state.baseline_main_sha)
        log(f"Reset main to baseline {state.baseline_main_sha[:7]}", "WARN")
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

    # Ensure clean git state: abort any leftover merge, reset to HEAD
    git("checkout", MAIN_BRANCH)
    git("merge", "--abort", check=False)
    git("reset", "--hard", "HEAD")

    # Squash merge the task branch
    result = run_cmd(
        ["git", "merge", "--squash", task.branch],
        check=False,
    )

    if result.returncode != 0:
        # Check for conflict markers (U=unmerged, A=added, D=deleted)
        status = git("status", "--short")
        has_conflicts = any(
            "U" in line[:2]
            for line in status.splitlines()
            if len(line) >= 2
        )
        if has_conflicts:
            conflict_files = [
                line[3:].strip() for line in status.splitlines()
                if len(line) >= 2 and "U" in line[:2]
            ]
            task.status = "failed"
            task.error = f"Merge conflicts in: {', '.join(conflict_files)}"
        else:
            task.status = "failed"
            task.error = f"Merge failed: {result.stderr[:200] if result.stderr else 'unknown error'}"
        log(task.error, "ERROR")
        git("reset", "--hard", "HEAD")
        return

    # Stage changes: tracked modifications + any new files
    git("add", "-A")

    # Check if there are actually changes to commit
    diff = git("diff", "--cached", "--name-only")
    if not diff:
        log(f"#{task.number} had no changes to merge (already on main?)", "WARN")
        task.status = "merged"
        return

    # Commit the merge
    commit_msg = (
        f"feat: {task.title}\n\n"
        f"Closes #{task.number}\n\n"
        f"Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
    )
    git("commit", "-m", commit_msg)
    merged_sha = git("rev-parse", "HEAD")
    log(f"#{task.number} merged: {merged_sha[:7]}", "OK")

    # Post-merge typecheck
    log("Post-merge typecheck...", "RUN")
    result = run_cmd(["npx", "tsc", "--noEmit"], check=False)
    if result.returncode != 0:
        log(f"Post-merge typecheck FAILED for #{task.number}", "ERROR")
        log("Removing bad merge commit...", "WARN")
        git("reset", "--hard", "HEAD~1")
        task.status = "failed"
        task.error = "Post-merge typecheck failed — merge removed"
        return
    log("Post-merge typecheck passed", "OK")

    # Only record as merged AFTER typecheck passes (B4 fix)
    task.status = "merged"
    state.merged_shas.append(merged_sha)


# ---------------------------------------------------------------------------
# Phase 6: Push and cleanup
# ---------------------------------------------------------------------------

def push_and_cleanup(state: RunState, no_push: bool = False) -> None:
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
        log("Merged commits are on local main — inspect with: git log --oneline -10", "WARN")
        cleanup_worktrees(state)
        return
    log("Final tests passed", "OK")

    if no_push:
        log("--no-push: skipping push. Inspect results:", "WARN")
        log(f"  git log --oneline -{len(merged) + 1}", "INFO")
        log(f"  npm run dev  # then open http://localhost:5173", "INFO")
        log(f"  git push origin {MAIN_BRANCH}  # when satisfied", "INFO")
        cleanup_worktrees(state)
        return

    # Push
    log("Pushing to origin...", "RUN")
    git("push", "origin", MAIN_BRANCH)
    log(f"Pushed {len(merged)} features to origin/{MAIN_BRANCH}", "OK")

    cleanup_worktrees(state)


def cleanup_worktrees(state: RunState) -> None:
    """Remove all worktrees and their branches."""
    log("Cleaning up worktrees...", "RUN")
    git("checkout", MAIN_BRANCH, check=False)
    for task in state.tasks:
        if task.worktree.exists():
            git("worktree", "remove", str(task.worktree), "--force", check=False)
        if task.branch:
            git("branch", "-D", task.branch, check=False)
    if WORKTREE_DIR.exists():
        try:
            WORKTREE_DIR.rmdir()
        except OSError:
            pass
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

    # Show log file locations for debugging
    has_logs = any(
        str(t.log_file) != "." and t.log_file.exists() for t in state.tasks
    )
    if has_logs:
        print(f"\n  Worker logs:", flush=True)
        for task in state.tasks:
            if str(task.log_file) != "." and task.log_file.exists():
                size_kb = task.log_file.stat().st_size / 1024
                print(f"    #{task.number}: {task.log_file} ({size_kb:.1f}KB)", flush=True)


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------

def run_batch(
    tasks: list[IssueTask],
    dry_run: bool = False,
    max_parallel: int = 4,
    worker_timeout: int = DEFAULT_WORKER_TIMEOUT,
    no_push: bool = False,
) -> RunState:
    """Run a batch of issues through the full pipeline."""
    global _current_state
    state = RunState(tasks=tasks)
    _current_state = state

    # --- Phase 1: Display plan ---
    log_header(f"PLAN: {len(tasks)} issues")
    for task in tasks:
        log(f"#{task.number}: {task.title}")

    if dry_run:
        log("Dry run — stopping here", "WARN")
        return state

    # --- Phase 2: Preflight ---
    preflight(state)

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
    last_status_print = 0.0
    status_interval = 30.0  # print status every 30 seconds

    try:
        while pending or active:
            # Spawn up to max_parallel
            while pending and len(active) < max_parallel:
                task = pending.pop(0)
                proc = spawn_worker(task)
                active[task.number] = (task, proc, time.time())

            if not active:
                break

            time.sleep(2)
            finished = []
            now = time.time()

            # Periodic status update
            if now - last_status_print > status_interval and active:
                print_worker_status(active, now)
                last_status_print = now

            for num, (task, proc, start_time) in active.items():
                elapsed = now - start_time

                # Check for stalled workers (no output growth)
                if (
                    task.last_output_time > 0
                    and now - task.last_output_time > STALL_THRESHOLD_SECONDS
                    and elapsed > STALL_THRESHOLD_SECONDS
                ):
                    stall_mins = int((now - task.last_output_time) / 60)
                    if stall_mins % 2 == 0:  # warn every 2 minutes of stall
                        log(f"#{num} appears stalled — no output for {stall_mins}m", "WARN")

                # Check timeout
                if elapsed > worker_timeout:
                    log(f"#{num} TIMED OUT after {elapsed:.0f}s — killing", "ERROR")
                    proc.kill()
                    proc.wait()
                    task.status = "failed"
                    task.error = f"Timed out after {elapsed:.0f}s"
                    finished.append(num)
                    check_main_not_contaminated(state)
                    continue

                if proc.poll() is not None:
                    finished.append(num)
                    # Read stderr (stdout goes to log file)
                    stderr = ""
                    if proc.stderr:
                        try:
                            stderr = proc.stderr.read()
                        except (OSError, ValueError):
                            pass
                    if proc.returncode != 0 and stderr:
                        log(f"#{num} worker exited with code {proc.returncode}", "WARN")
                        log(f"  stderr: {stderr[:200]}", "WARN")

                    # Log final output size
                    if task.log_file.exists():
                        size_kb = task.log_file.stat().st_size / 1024
                        log(f"#{num} finished — {size_kb:.1f}KB output", "OK")

                    verify_worker_result(task, state)

            for num in finished:
                task_proc = active[num][1]
                if task_proc in _active_procs:
                    _active_procs.remove(task_proc)
                del active[num]
    finally:
        # Kill any remaining workers if we exit the loop unexpectedly
        for _, (task, proc, _) in active.items():
            proc.kill()
            proc.wait()
            if task.status == "running":
                task.status = "failed"
                task.error = "Killed during shutdown"

    # --- Phase 5: Merge in order ---
    log_header("MERGE")
    done_tasks = [t for t in tasks if t.status == "done"]
    for task in done_tasks:
        merge_task(task, state)

    # --- Phase 6: Push and cleanup ---
    push_and_cleanup(state, no_push=no_push)

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
        default=DEFAULT_WORKER_TIMEOUT,
        help=f"Worker timeout in seconds (default: {DEFAULT_WORKER_TIMEOUT})",
    )
    parser.add_argument(
        "--no-push",
        action="store_true",
        help="Do everything except push — inspect results before making permanent",
    )
    args = parser.parse_args()

    if not args.issues and not args.all:
        parser.error("Provide issue numbers or --all")

    # Cap max_parallel to prevent resource exhaustion
    max_parallel = min(args.max_parallel, MAX_PARALLEL_CAP)
    if args.max_parallel > MAX_PARALLEL_CAP:
        log(f"Capping --max-parallel to {MAX_PARALLEL_CAP} (requested {args.max_parallel})", "WARN")

    # Fetch issues
    log_header("FETCH ISSUES")
    try:
        if args.all:
            tasks = fetch_all_open_issues()
            log(f"Found {len(tasks)} open non-deferred issues")
        else:
            tasks = []
            for num in args.issues:
                task = fetch_issue(num)
                tasks.append(task)
                log(f"Fetched #{task.number}: {task.title}")
    except RuntimeError as e:
        log(f"Failed to fetch issues: {e}", "ERROR")
        sys.exit(1)

    if not tasks:
        log("No issues to process", "WARN")
        return

    start = time.time()
    state = run_batch(
        tasks,
        dry_run=args.dry_run,
        max_parallel=max_parallel,
        worker_timeout=args.timeout,
        no_push=args.no_push,
    )
    elapsed = time.time() - start

    print_report(state, elapsed)

    failed = [t for t in state.tasks if t.status == "failed"]
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
