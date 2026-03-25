---
name: run
description: Implement GitHub issues safely in this repo. Use when asked to "/run", "implement issue #N", "fix bug #N", or "batch these issues". Fetches issues, plans work, dispatches built-in Codex subagents, reviews, verifies, and only merges or closes when the user explicitly asks for full integration.
---

# Run: Issue Implementation Orchestrator

Implements GitHub issues by dispatching worker subagents, reviewing their output,
then optionally merging and closing.

## 1. Defaults

Default behavior is conservative:
- implement locally
- review locally
- verify locally
- parallelize only when tasks are independent
- summarize what is ready
- do **not** merge, push, or close issues unless the user explicitly asked for a full integration run

In this Codex environment, use built-in subagent roles only:
- `explorer` for codebase search and planning support
- `worker` for implementation
- `default` for review and completeness checks

Do **not** assume custom named agent types such as `reviewer` are available, even if the repo has local agent TOMLs.

## 2. Setup

Resolve the main branch:

```bash
MAIN=$(git symbolic-ref refs/remotes/origin/HEAD | sed 's|refs/remotes/origin/||')
```

Parse arguments:
- No args: fetch open non-deferred issues with `gh issue list --state open --limit 50`
- Numeric args like `800 801`: fetch each with `gh issue view N --comments`
- String arg: treat as an issue search phrase, not a reason to create a new issue automatically

Preflight:
1. Check `gh auth status`
2. Check `git status --short`
3. Run `npm run build`

Safety rules:
- Never auto-commit unrelated tracked files just to "clean up main"
- If the working tree is dirty, isolate the work in a temp clone or worktree instead of sweeping unrelated edits into a commit
- If `npm run build` fails before the issue work starts, stop and report it

## 3. Triage

| Condition | Tier | Behavior |
|-----------|------|----------|
| 1 issue, ≤3 files, obvious fix | **quick** | Implement directly or with one worker, review, verify, then stop unless full integration was explicitly requested |
| Everything else | **batch** | Plan, partition into dependency-safe waves, dispatch independent workers in parallel, review each completion, verify each completion, and merge ready work early if full integration was explicitly requested |

## 4. Planning (Batch)

For 2+ issues, plan before dispatching.

For each issue:
- Read the issue body + all comments (especially reopen comments — they specify what's incomplete)
- Spawn `explorer` subagent to search the codebase and identify affected files
- Estimate complexity

Create a task list:
- `task_id`, `issue_refs`, `title`, `files` (specific paths)
- `dependencies` (which tasks must complete first)
- `done_criteria` (concrete, verifiable — workers don't see issue bodies)
- `write_scope` (exact files or directories the task may edit)
- `wave` (parallel group of tasks with no dependency or write-scope overlap)
- `merge_order` (topological sort of dependencies)

**Rules:**
- Each task ≤15 files
- done_criteria must encode ALL acceptance criteria from the issue
- For reopened issues, fix only the gap described in the reopen comment
- Only run tasks in parallel when their `write_scope` is disjoint
- Keep the top-level agent as the coordinator; workers are leaf implementers, not managers

## 5. Worker Dispatch

Workers may run in parallel, but only when the tasks are independent.
The top-level agent owns coordination, review, verification, and integration.
Workers stay bounded to one task each.

Dispatch rules:
- Use separate worktrees or isolated branches per task
- Start all ready tasks in the current `wave` up to a reasonable cap (usually 2 to 4)
- Do not run two workers concurrently if they may edit the same file or tightly coupled area
- Do not wait for the entire batch before reviewing; handle each completed task immediately
- While one task is under review or verification, other independent workers may keep running

For each ready task:

1. **Spawn `worker` subagent** with this prompt:
   ```
   Implement task: <title>
   Issue: #N
   Files: <file list>

   Done criteria:
   1. <criterion>
   2. <criterion>
   ...
   ```

2. **Let other ready workers run in parallel.**

3. **When a worker finishes**, inspect its branch/worktree immediately.

4. **If worker didn't commit**, inspect the branch and either:
   - commit the worker's changes yourself, or
   - treat the task as incomplete if the worker's result is not reviewable

5. **Spawn a `default` review subagent**:
   ```
   Review the changes on branch <branch> for issue #N.
   Compare against main: git diff main...<branch>
   Done criteria from the task:
   1. <criterion>
   2. <criterion>

   Output:
   - findings ordered by severity
   - VERDICT: approve | request-changes
   ```

6. **If reviewer says `request-changes`**: spawn another worker to fix the
   specific findings, then re-review. Max 2 fix rounds.

7. **If reviewer says `approve`**: proceed to verification right away.

8. **After verification passes**, mark the task `ready_to_merge`.
   If full integration was requested and dependencies are satisfied, merge it
   promptly instead of waiting for the entire batch to finish.

## 6. Verification

Run verification after each reviewed task.

Verification tiers:

| Files changed | Verify |
|---------------|--------|
| `src/parser/**`, `src/plugins/**`, `src-tauri/**` | lint + build + test + typecheck |
| `src/**/*.ts`, `src/**/*.tsx` | lint + build + test |
| Everything else | build only |

Commands:
```bash
npm run build
npm run lint
npm run test
npx tsc --noEmit
```

For visual changes, also run:
```bash
npm run test:browser
```
if the browser environment is available.

Repo-specific gate:
- Before any commit, try the repo-mandated reviewer/simplifier gate if the tools exist:
  - `pr-review-toolkit:code-reviewer`
  - `pr-review-toolkit:code-simplifier`
- If those binaries are unavailable in the environment, record that fact and fall back to:
  - your own diff review
  - one read-only review subagent pass

Never claim success from code changes alone. Verification output must support the claim.
Do not let verified tasks pile up unmerged if the user requested full integration.

## 7. Integration Policy

Only do this section if the user explicitly asked for a full integration run.

Otherwise stop after reviewed, verified implementation and report:
- issue status
- branch name / commit
- verification results
- anything blocking merge or closure

If full integration was explicitly requested, merge incrementally:
- merge a task as soon as it is reviewed, verified, dependency-safe, and conflict-safe
- do not wait for 5 to 10 approved tasks to accumulate
- prefer keeping at most 1 to 3 reviewed-but-unmerged tasks pending
- after each merge, rerun the minimum verification needed to protect `main`
- if `main` moved materially, re-review the remaining unmerged task against updated `main`

Use a conservative merge protocol:

```bash
git checkout $MAIN
git pull origin $MAIN
git merge --squash <worker-branch>
git commit -m "type(scope): description (#N)

Co-Authored-By: Codex <noreply@openai.com>"
git push origin $MAIN
git branch -D <worker-branch>
```

Rules:
- never force push
- never merge with failing verification
- never merge unrelated local changes
- if the target branch moved materially during the run, re-review before pushing
- if two approved tasks conflict, merge the simpler or more foundational one first, then restack or rework the other before merging
- after each incremental merge, prefer a quick repo health check (`npm run build` at minimum; add more if the changed area demands it)

After all merges, rerun `npm run build`.

## 8. Issue Closure Gate

**This gate is mandatory. Never call `gh issue close` without a completeness check.**

For each issue:

1. **Spawn a `default` review subagent** as a completeness reviewer:
   ```
   Completeness review for issue #N in /path/to/repo.

   Run: gh issue view N
   Read the acceptance criteria.
   For each criterion, verify it is met in the CURRENT codebase
   (not just the diff — read the actual files).

   For each criterion:
     CRITERION: <text>
     STATUS: met | unmet
     EVIDENCE: <file:line or grep result>

   Final verdict: COMPLETE | INCOMPLETE
   If INCOMPLETE, list what remains.
   ```

2. **If COMPLETE and the user asked for full integration**:
   `gh issue close N --comment "<evidence summary>"`

3. **If INCOMPLETE**: spawn a fix worker targeting only the unmet criteria.
   After fix + merge, re-run the completeness review. Max 2 retry rounds.
   If still incomplete after retries, post unmet criteria as an issue comment
   and do NOT close.

## 9. Project-Specific Notes

- **Commit format:** `type(scope): description (#N)` — conventional commits
- **Test pattern:** tests next to source: `foo.ts` → `foo.test.ts`
- **Temp files:** use `/tmp/coflat-*`, never project directory
- **No `git add -A`:** stage specific files only
- **Deferred issues:** skip issues labeled `deferred`
- **Read mode is deferred:** do not implement read-mode features
- **Closing fence always hidden:** zero height, protected by transaction filter
- **Block headers:** Decoration.replace covers ONLY fence prefix, NOT title text
- **Browser verification:** use `npm run dev` + `npm run chrome` + `__cmDebug.dump()` when the changed feature needs live editor validation
- **Do not silently create issues, merge, push, or close:** these are explicit actions, not the default meaning of "/run"
