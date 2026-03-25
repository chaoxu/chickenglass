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
| Everything else | **batch** | Plan, dispatch workers sequentially, review each, verify each, then stop unless full integration was explicitly requested |

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
- `merge_order` (topological sort of dependencies)

**Rules:**
- Each task ≤15 files
- done_criteria must encode ALL acceptance criteria from the issue
- For reopened issues, fix only the gap described in the reopen comment

## 5. Worker Dispatch

**IMPORTANT: Workers run sequentially**, not in parallel. They share the
filesystem and git state. Each worker runs to completion before the next starts.

For each task (in merge_order):

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

2. **Wait for worker to report STATUS.**

3. **If worker didn't commit**, inspect the branch and either:
   - commit the worker's changes yourself, or
   - treat the task as incomplete if the worker's result is not reviewable

4. **Spawn a `default` review subagent**:
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

5. **If reviewer says `request-changes`**: spawn another worker to fix the
   specific findings, then re-review. Max 2 fix rounds.

6. **If reviewer says `approve`**: proceed to verification.

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

## 7. Integration Policy

Only do this section if the user explicitly asked for a full integration run.

Otherwise stop after reviewed, verified implementation and report:
- issue status
- branch name / commit
- verification results
- anything blocking merge or closure

If full integration was explicitly requested, use a conservative merge protocol:

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
