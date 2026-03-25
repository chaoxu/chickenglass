---
name: run
description: Implement GitHub issues. Use when asked to "/run", "implement issue #N", "fix bug #N", or "batch these issues". Fetches issues, plans work, dispatches worker subagents, reviews, merges, and closes.
---

# Run: Issue Implementation Orchestrator

Implements GitHub issues by dispatching worker subagents, reviewing their output,
then merging and closing.

## 1. Setup

```bash
MAIN=$(git symbolic-ref refs/remotes/origin/HEAD | sed 's|refs/remotes/origin/||')
```

**Parse arguments:**
- No args → fetch all open non-deferred issues: `gh issue list --state open --limit 50`, exclude "deferred" label
- Numeric args (e.g., `800 801`) → fetch each: `gh issue view N`
- String arg (e.g., `"fix currency"`) → create issue: `gh issue create --title "..." --body ""`

**Preflight:**
1. Commit any uncommitted tracked files on main and push
2. Run `npm run build` — must pass before proceeding

## 2. Triage

| Condition | Tier | Behavior |
|-----------|------|----------|
| 1 issue, ≤3 files, obvious fix | **quick** | Implement directly (no subagent) → review → merge → close |
| Everything else | **batch** | Plan → dispatch workers sequentially → review each → merge → close |

## 3. Planning (Batch)

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

## 4. Worker Dispatch

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

3. **If worker didn't commit**, check `git status` for changes and commit on behalf.

4. **Spawn `reviewer` subagent** on the worker's branch:
   ```
   Review the changes on branch <branch> for issue #N.
   Compare against main: git diff main...<branch>
   Done criteria from the task:
   1. <criterion>
   2. <criterion>
   ```

5. **If reviewer says `request-changes`**: spawn another worker to fix the
   specific findings, then re-review. Max 2 fix rounds.

6. **If reviewer says `approve`**: proceed to merge.

## 5. Merge Protocol

After each task is reviewed and approved:

```bash
git checkout $MAIN
git pull origin $MAIN
git merge --squash <worker-branch>
git commit -m "type(scope): description (#N)

Co-Authored-By: Codex <noreply@openai.com>"
git push origin $MAIN
git branch -D <worker-branch>
```

After all merges: `npm run build` (integration verify gate).

## 6. Issue Closure Gate

**This gate is mandatory. Never call `gh issue close` without a completeness check.**

For each issue:

1. **Spawn `reviewer` subagent** as a completeness reviewer:
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

2. **If COMPLETE**: `gh issue close N --comment "<evidence summary>"`

3. **If INCOMPLETE**: Spawn a fix worker targeting only the unmet criteria.
   After fix + merge, re-run the completeness review. Max 2 retry rounds.
   If still incomplete after retries, post unmet criteria as an issue comment
   and do NOT close.

## 7. Verification Tiers

| Files changed | Verify |
|---------------|--------|
| `src/parser/**`, `src/plugins/**`, `src-tauri/**` | lint + build + test + typecheck |
| `src/**/*.ts`, `src/**/*.tsx` | lint + build + test |
| Everything else | build only |

Commands:
```bash
npm run build             # always
npm run lint              # expect 0 errors
npm run test              # all tests pass
npx tsc --noEmit          # typecheck
```

## 8. Visual Verification

For tasks that change CSS, rendering, decorations, themes, or layout:

The project has `npm run test:browser` (CDP regression suite). If available
in the sandbox, run it. If not, add a note to the closure comment:
"Visual verification not performed — requires browser."

Do NOT close visual issues without either browser verification or this explicit note.

## 9. Project-Specific Notes

- **Commit format:** `type(scope): description (#N)` — conventional commits
- **Test pattern:** tests next to source: `foo.ts` → `foo.test.ts`
- **Temp files:** use `/tmp/coflat-*`, never project directory
- **No `git add -A`:** stage specific files only
- **Deferred issues:** skip issues labeled `deferred`
- **Read mode is deferred:** do not implement read-mode features
- **Closing fence always hidden:** zero height, protected by transaction filter
- **Block headers:** Decoration.replace covers ONLY fence prefix, NOT title text
