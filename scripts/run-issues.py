#!/usr/bin/env python3
"""
Deterministic issue orchestrator for Coflat.

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
import re
import signal
import subprocess
import sys
import time
import types
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKTREE_DIR = REPO_ROOT / ".worktrees"
MAIN_BRANCH = "main"
DEFAULT_MAX_PARALLEL = 4
MAX_PARALLEL_CAP = 8
DEFERRED_LABEL = "deferred"
DEFAULT_WORKER_TIMEOUT = 30 * 60  # 30 minutes
STALL_THRESHOLD_SECONDS = 5 * 60  # 5 minutes
STALL_WARN_INTERVAL = 2 * 60     # warn at most every 2 minutes per worker
LOG_DIR = REPO_ROOT / ".worktrees" / "logs"

# Regex to strip conventional commit prefixes from issue titles
_PREFIX_RE = re.compile(r"^(feat|fix|docs|refactor|test|chore):\s*")


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
    log_fh: IO[str] | None = field(default=None, repr=False)
    last_output_size: int = 0
    last_output_time: float = 0.0
    last_stall_warn: float = 0.0
    last_commit_count: int = 0


@dataclass
class RunState:
    """State for the entire run."""
    tasks: list[IssueTask] = field(default_factory=list)
    merged_shas: list[str] = field(default_factory=list)
    baseline_main_sha: str = ""


# Active worker processes — global for signal handler cleanup
_active_procs: list[subprocess.Popen[str]] = []
_current_state: RunState | None = None


# ---------------------------------------------------------------------------
# Signal handling
# ---------------------------------------------------------------------------

def _shutdown_handler(signum: int, _frame: types.FrameType | None) -> None:
    """Kill all active workers and clean up on Ctrl+C or SIGTERM."""
    sig_name = signal.Signals(signum).name
    print(f"\n  [!] Received {sig_name} — shutting down...", flush=True)

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

    if _current_state:
        # Close any open log file handles
        for task in _current_state.tasks:
            _close_log(task)
        print("  [!] Cleaning up worktrees...", flush=True)
        cleanup_worktrees(_current_state)

    try:
        subprocess.run(["git", "merge", "--abort"], cwd=REPO_ROOT, capture_output=True, check=False)
        subprocess.run(["git", "checkout", MAIN_BRANCH], cwd=REPO_ROOT, capture_output=True, check=False)
        subprocess.run(["git", "reset", "--hard", "HEAD"], cwd=REPO_ROOT, capture_output=True, check=False)
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
    cwd: Path | None = None,
    check: bool = True,
    capture: bool = True,
    timeout: int | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run a command with proper error handling."""
    try:
        result = subprocess.run(
            args, cwd=cwd or REPO_ROOT, capture_output=capture, text=True, timeout=timeout,
        )
    except FileNotFoundError:
        cmd = args[0] if args else "unknown"
        raise RuntimeError(f"Command not found: '{cmd}'. Is it installed and on PATH?") from None
    if check and result.returncode != 0:
        stderr = result.stderr.strip() if result.stderr else ""
        raise RuntimeError(f"Command failed: {' '.join(args)}\nExit code: {result.returncode}\nStderr: {stderr}")
    return result


def git(*args: str, cwd: Path | None = None, check: bool = True) -> str:
    """Run a git command and return stdout."""
    return run_cmd(["git", *args], cwd=cwd, check=check).stdout.strip()


_LOG_SYMBOLS = {"INFO": ".", "OK": "+", "WARN": "!", "ERROR": "X", "RUN": ">"}


def log(msg: str, level: str = "INFO") -> None:
    """Print a timestamped log message."""
    ts = time.strftime("%H:%M:%S")
    print(f"  [{ts}] {_LOG_SYMBOLS.get(level, '.')} {msg}", flush=True)


def log_header(msg: str) -> None:
    """Print a section header."""
    print(f"\n{'=' * 60}\n  {msg}\n{'=' * 60}", flush=True)


def _close_log(task: IssueTask) -> None:
    """Close the log file handle if open."""
    if task.log_fh and not task.log_fh.closed:
        task.log_fh.close()
    task.log_fh = None


def _commit_prefix(title: str) -> str:
    """Detect appropriate conventional commit prefix from the issue title."""
    lower = title.lower()
    if lower.startswith("fix:") or lower.startswith("fix ") or "bug" in lower:
        return "fix"
    return "feat"


def _clean_title(title: str) -> str:
    """Strip any existing conventional commit prefix from the title."""
    return _PREFIX_RE.sub("", title)


def _worktree_commit_count(task: IssueTask, baseline_sha: str) -> int:
    """Count commits on the worktree branch since the baseline."""
    if not task.worktree.exists():
        return 0
    try:
        output = git("rev-list", "--count", f"{baseline_sha}..HEAD", cwd=task.worktree, check=False)
        return int(output) if output.isdigit() else 0
    except (RuntimeError, ValueError):
        return 0


# ---------------------------------------------------------------------------
# Phase 1: Fetch issues
# ---------------------------------------------------------------------------

def fetch_issue(number: int) -> IssueTask:
    """Fetch a single issue from GitHub."""
    result = run_cmd(["gh", "issue", "view", str(number), "--json", "number,title,body"])
    data = json.loads(result.stdout)
    return IssueTask(number=data["number"], title=data["title"], body=data.get("body", ""))


def fetch_all_open_issues() -> list[IssueTask]:
    """Fetch all open non-deferred issues from GitHub."""
    result = run_cmd(["gh", "issue", "list", "--state", "open", "--json", "number,title,body,labels", "--limit", "500"])
    all_issues = json.loads(result.stdout)
    tasks = []
    for i in all_issues:
        labels = {lbl.get("name", "") for lbl in i.get("labels", [])}
        if DEFERRED_LABEL in labels:
            log(f"Skipping #{i['number']}: {i['title']} (deferred)", "INFO")
            continue
        tasks.append(IssueTask(number=i["number"], title=i["title"], body=i.get("body", "")))
    return tasks


# ---------------------------------------------------------------------------
# Phase 2: Preflight checks
# ---------------------------------------------------------------------------

def preflight(state: RunState) -> None:
    """Verify the repo is in a clean state before starting."""
    log_header("PREFLIGHT")

    status = git("status", "--short")
    tracked = [line for line in status.splitlines() if not line.startswith("??")]
    if tracked:
        log("Uncommitted tracked changes found:", "ERROR")
        for line in tracked:
            log(f"  {line}", "ERROR")
        raise RuntimeError("Cannot proceed with uncommitted changes. Commit or stash first.")
    log("Working tree is clean", "OK")

    branch = git("branch", "--show-current")
    if branch != MAIN_BRANCH:
        raise RuntimeError(f"Must be on '{MAIN_BRANCH}' branch, currently on '{branch}'")
    log(f"On branch '{MAIN_BRANCH}'", "OK")

    git("pull", "--ff-only", "origin", MAIN_BRANCH, check=False)
    log("Pulled latest from origin", "OK")

    state.baseline_main_sha = git("rev-parse", "HEAD")
    log(f"Baseline main SHA: {state.baseline_main_sha[:7]}", "OK")

    log("Running typecheck...", "RUN")
    run_cmd(["npx", "tsc", "--noEmit"])
    log("Typecheck passed", "OK")

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

    if task.worktree.exists():
        git("worktree", "remove", str(task.worktree), "--force", check=False)
    git("branch", "-D", task.branch, check=False)
    git("worktree", "add", str(task.worktree), "-b", task.branch, MAIN_BRANCH)
    log(f"Created worktree: {task.worktree}", "OK")

    actual = git("branch", "--show-current", cwd=task.worktree)
    if actual != task.branch:
        raise RuntimeError(f"Worktree branch mismatch: expected '{task.branch}', got '{actual}'")
    log(f"Isolation verified: branch is '{actual}'", "OK")


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
   {_commit_prefix(task.title)}: {_clean_title(task.title)}

   Closes #{task.number}

   Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>

6. Do NOT push. The orchestrator handles merging and pushing.
"""


def spawn_worker(task: IssueTask) -> subprocess.Popen[str]:
    """Spawn a Claude worker process for a task."""
    prompt = build_worker_prompt(task)
    task.status = "running"
    task.last_output_time = time.time()

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    task.log_file = LOG_DIR / f"worker-{task.number}.log"
    task.log_fh = open(task.log_file, "w")

    log(f"Spawning worker for #{task.number}: {task.title}", "RUN")
    log(f"  Log: {task.log_file}", "INFO")

    proc = subprocess.Popen(
        ["claude", "--print", "--dangerously-skip-permissions", "-p", prompt],
        cwd=task.worktree,
        stdout=task.log_fh,
        stderr=task.log_fh,  # merge stderr into log file to avoid pipe deadlock
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
    baseline_sha: str,
) -> None:
    """Print a one-line status for each active worker."""
    lines = []
    for num, (task, _, start_time) in sorted(active.items()):
        elapsed = now - start_time
        mins, secs = divmod(int(elapsed), 60)

        # Monitor worktree git state (commits) instead of stdout size
        commits = _worktree_commit_count(task, baseline_sha)
        commit_str = f"{commits}c" if commits > 0 else "0c"

        # Also check log file size
        output_size = task.log_file.stat().st_size if task.log_file.exists() else 0
        size_kb = output_size / 1024

        # Update stall tracking based on commits (more reliable than stdout)
        if commits > task.last_commit_count or output_size > task.last_output_size:
            task.last_commit_count = commits
            task.last_output_size = output_size
            task.last_output_time = now

        stalled = ""
        stall_duration = now - task.last_output_time
        if stall_duration > STALL_THRESHOLD_SECONDS:
            stall_mins = int(stall_duration / 60)
            stalled = f" STALLED {stall_mins}m!"

        lines.append(f"#{num} {mins}m{secs:02d}s {commit_str} {size_kb:.1f}KB{stalled}")

    if lines:
        log("  ".join(lines), "RUN")


def check_main_not_contaminated(state: RunState) -> bool:
    """Check if main branch received unexpected commits."""
    if not state.baseline_main_sha:
        log("No baseline SHA — cannot check contamination", "WARN")
        return True
    current = git("rev-parse", MAIN_BRANCH)
    if current != state.baseline_main_sha:
        log(f"ISOLATION ESCAPE: main moved from {state.baseline_main_sha[:7]} to {current[:7]}", "ERROR")
        return False
    return True


def verify_worker_result(task: IssueTask, state: RunState) -> None:
    """Verify a completed worker's output."""
    _close_log(task)
    log(f"Verifying #{task.number}...", "RUN")

    if not check_main_not_contaminated(state):
        task.status = "failed"
        task.error = "ISOLATION ESCAPE: worker committed to main branch"
        log(task.error, "ERROR")
        git("checkout", MAIN_BRANCH)
        git("reset", "--hard", state.baseline_main_sha)
        log(f"Reset main to baseline {state.baseline_main_sha[:7]}", "WARN")
        return

    actual = git("branch", "--show-current", cwd=task.worktree)
    if actual != task.branch:
        task.status = "failed"
        task.error = f"Branch mismatch: expected '{task.branch}', got '{actual}'"
        log(task.error, "ERROR")
        return

    main_sha = git("rev-parse", MAIN_BRANCH, cwd=task.worktree)
    head_sha = git("rev-parse", "HEAD", cwd=task.worktree)

    if head_sha == main_sha:
        status = git("status", "--short", cwd=task.worktree)
        task.status = "failed"
        task.error = "Worker left uncommitted changes" if status else "Worker produced no changes"
        log(task.error, "ERROR")
        return

    task.commit_sha = head_sha
    task.status = "done"
    log(f"#{task.number} done: {head_sha[:7]}", "OK")

    log(f"Typechecking #{task.number}...", "RUN")
    result = run_cmd(["npx", "tsc", "--noEmit"], cwd=task.worktree, check=False)
    if result.returncode != 0:
        task.status = "failed"
        task.error = f"Typecheck failed:\n{result.stderr[:500]}"
        log(f"#{task.number} typecheck failed", "ERROR")
        return
    log(f"#{task.number} typecheck passed", "OK")

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

    git("checkout", MAIN_BRANCH)
    git("merge", "--abort", check=False)
    git("reset", "--hard", "HEAD")

    result = run_cmd(["git", "merge", "--squash", task.branch], check=False)
    if result.returncode != 0:
        status = git("status", "--short")
        has_conflicts = any("U" in line[:2] for line in status.splitlines() if len(line) >= 2)
        if has_conflicts:
            files = [line[3:].strip() for line in status.splitlines() if len(line) >= 2 and "U" in line[:2]]
            task.error = f"Merge conflicts in: {', '.join(files)}"
        else:
            task.error = f"Merge failed: {result.stderr[:200] if result.stderr else 'unknown error'}"
        task.status = "failed"
        log(task.error, "ERROR")
        git("reset", "--hard", "HEAD")
        return

    git("add", "-A")

    if not git("diff", "--cached", "--name-only"):
        log(f"#{task.number} had no changes to merge", "WARN")
        task.status = "merged"
        return

    prefix = _commit_prefix(task.title)
    clean = _clean_title(task.title)
    commit_msg = f"{prefix}: {clean}\n\nCloses #{task.number}\n\nCo-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
    git("commit", "-m", commit_msg)
    merged_sha = git("rev-parse", "HEAD")
    log(f"#{task.number} merged: {merged_sha[:7]}", "OK")

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

    log("Pushing to origin...", "RUN")
    git("push", "origin", MAIN_BRANCH)
    log(f"Pushed {len(merged)} features to origin/{MAIN_BRANCH}", "OK")
    cleanup_worktrees(state)


def cleanup_worktrees(state: RunState) -> None:
    """Remove all worktrees and their branches."""
    log("Cleaning up worktrees...", "RUN")
    git("checkout", MAIN_BRANCH, check=False)
    for task in state.tasks:
        _close_log(task)
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

_STATUS_SYMBOLS = {"merged": "+", "done": "~", "failed": "X", "pending": "?", "running": ">"}


def print_report(state: RunState, elapsed: float) -> None:
    """Print a summary report."""
    log_header("REPORT")

    merged = [t for t in state.tasks if t.status == "merged"]
    failed = [t for t in state.tasks if t.status == "failed"]

    for task in state.tasks:
        symbol = _STATUS_SYMBOLS.get(task.status, "?")
        line = f"  [{symbol}] #{task.number} {task.title}"
        if task.error:
            line += f" — {task.error}"
        print(line, flush=True)

    print(f"\n  Merged: {len(merged)}/{len(state.tasks)}", flush=True)
    if failed:
        print(f"  Failed: {len(failed)}/{len(state.tasks)}", flush=True)
    print(f"  Time:   {elapsed:.0f}s", flush=True)

    log_tasks = [t for t in state.tasks if t.log_file.name and t.log_file.exists()]
    if log_tasks:
        print("\n  Worker logs:", flush=True)
        for task in log_tasks:
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

    log_header(f"PLAN: {len(tasks)} issues")
    for task in tasks:
        log(f"#{task.number}: {task.title}")

    if dry_run:
        log("Dry run — stopping here", "WARN")
        return state

    preflight(state)

    log_header("CREATE WORKTREES")
    WORKTREE_DIR.mkdir(parents=True, exist_ok=True)
    for task in tasks:
        try:
            create_worktree(task)
        except RuntimeError as e:
            task.status = "failed"
            task.error = str(e)
            log(f"Failed to create worktree for #{task.number}: {e}", "ERROR")

    log_header("SPAWN WORKERS")
    pending = [t for t in tasks if t.status == "pending"]
    active: dict[int, tuple[IssueTask, subprocess.Popen[str], float]] = {}
    last_status_print = 0.0

    try:
        while pending or active:
            while pending and len(active) < max_parallel:
                task = pending.pop(0)
                proc = spawn_worker(task)
                active[task.number] = (task, proc, time.time())

            time.sleep(2)
            finished = []
            now = time.time()

            # Periodic status (every 30s)
            if now - last_status_print > 30.0 and active:
                print_worker_status(active, now, state.baseline_main_sha)
                last_status_print = now

            for num, (task, proc, start_time) in active.items():
                elapsed = now - start_time

                # Time-based stall warning (at most once per STALL_WARN_INTERVAL)
                stall_duration = now - task.last_output_time
                if (
                    stall_duration > STALL_THRESHOLD_SECONDS
                    and elapsed > STALL_THRESHOLD_SECONDS
                    and now - task.last_stall_warn > STALL_WARN_INTERVAL
                ):
                    stall_mins = int(stall_duration / 60)
                    log(f"#{num} appears stalled — no activity for {stall_mins}m", "WARN")
                    task.last_stall_warn = now

                if elapsed > worker_timeout:
                    log(f"#{num} TIMED OUT after {elapsed:.0f}s — killing", "ERROR")
                    proc.kill()
                    proc.wait()
                    _close_log(task)
                    task.status = "failed"
                    task.error = f"Timed out after {elapsed:.0f}s"
                    finished.append(num)
                    check_main_not_contaminated(state)
                    continue

                if proc.poll() is not None:
                    finished.append(num)
                    _close_log(task)

                    if proc.returncode != 0:
                        log(f"#{num} worker exited with code {proc.returncode}", "WARN")

                    if task.log_file.exists():
                        log(f"#{num} finished — {task.log_file.stat().st_size / 1024:.1f}KB output", "OK")

                    verify_worker_result(task, state)

            for num in finished:
                if active[num][1] in _active_procs:
                    _active_procs.remove(active[num][1])
                del active[num]
    finally:
        for task, proc, _start in active.values():
            if proc.poll() is None:
                try:
                    proc.kill()
                    proc.wait(timeout=5)
                except (OSError, subprocess.TimeoutExpired):
                    pass
            _close_log(task)
            if task.status == "running":
                task.status = "failed"
                task.error = "Killed during shutdown"

    log_header("MERGE")
    for task in [t for t in tasks if t.status == "done"]:
        merge_task(task, state)

    push_and_cleanup(state, no_push=no_push)
    return state


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Coflat issues through isolated Claude workers")
    parser.add_argument("issues", nargs="*", type=int, help="Issue numbers to implement")
    parser.add_argument("--all", action="store_true", help="Fetch and run all open non-deferred issues")
    parser.add_argument("--dry-run", action="store_true", help="Show plan without executing")
    parser.add_argument("--max-parallel", type=int, default=DEFAULT_MAX_PARALLEL, help=f"Max parallel workers (default: {DEFAULT_MAX_PARALLEL})")
    parser.add_argument("--timeout", type=int, default=DEFAULT_WORKER_TIMEOUT, help=f"Worker timeout in seconds (default: {DEFAULT_WORKER_TIMEOUT})")
    parser.add_argument("--no-push", action="store_true", help="Do everything except push — inspect results before making permanent")
    args = parser.parse_args()

    if not args.issues and not args.all:
        parser.error("Provide issue numbers or --all")

    max_parallel = min(args.max_parallel, MAX_PARALLEL_CAP)
    if args.max_parallel > MAX_PARALLEL_CAP:
        log(f"Capping --max-parallel to {MAX_PARALLEL_CAP} (requested {args.max_parallel})", "WARN")

    log_header("FETCH ISSUES")
    try:
        if args.all:
            tasks = fetch_all_open_issues()
            log(f"Found {len(tasks)} open non-deferred issues")
        else:
            tasks = [fetch_issue(num) for num in args.issues]
            for t in tasks:
                log(f"Fetched #{t.number}: {t.title}")
    except RuntimeError as e:
        log(f"Failed to fetch issues: {e}", "ERROR")
        sys.exit(1)

    if not tasks:
        log("No issues to process", "WARN")
        return

    start = time.time()
    state = run_batch(tasks, dry_run=args.dry_run, max_parallel=max_parallel, worker_timeout=args.timeout, no_push=args.no_push)
    print_report(state, time.time() - start)

    if any(t.status == "failed" for t in state.tasks):
        sys.exit(1)


if __name__ == "__main__":
    main()
