# Devx Workflow

This repo optimizes for short feedback loops during active coding and complete
evidence before an issue is closed.

## Issue Commands

Use the repo wrapper for issues:

```bash
pnpm issue -- list
pnpm issue -- list --state closed --limit 30
pnpm issue -- create --title "..." --description "..."
pnpm issue -- comment 1234 "Verification: ..."
pnpm issue -- close 1234
```

The wrapper pins `--repo chaoxu/coflat` and handles the local `tea` subcommand
order. Use raw `tea` for pulls and login inspection:

```bash
tea pulls --repo chaoxu/coflat
tea pr --repo chaoxu/coflat create --title "..." --base main --head <branch>
tea logins
```

## Verification Records

Every implementation issue should have a verification record before close. The
record can live in the issue, commit message, or PR description, but it must be
easy to find.

Use this shape:

```text
Verification:
- pnpm test:focused -- scripts/issue.test.mjs
- pnpm check:types

Result:
- pass

Residual risk:
- Not browser-facing; browser lane not run.
```

For performance issues, include before/after numbers on a large document as
described in `AGENTS.md`.

## Agent Branch Integration

Worker agents should report the human context first:

```text
Issue: #1234
Branch: worker/issue-1234
Changed paths:
- src/...

Verification:
- rtk pnpm test:focused -- src/foo.test.ts

Residual risk:
- ...
```

They should also include handoff JSON for tool ingestion:

```json
{
  "issue": "1234",
  "branch": "worker/issue-1234",
  "baseBranch": "main",
  "baseRef": "origin/main",
  "oldBase": "optional-original-base",
  "checks": ["rtk pnpm test:focused -- src/foo.test.ts"],
  "changedPaths": ["src/foo.ts"],
  "residualRisk": "..."
}
```

Use the merge helper to turn that report into a repeatable integration plan:

```bash
pnpm merge-task -- --handoff /tmp/coflat-agent-handoff.json
pnpm merge-task -- --branch worker/issue-1234 --base-branch main --base-ref origin/main --issue 1234 \
  --check "rtk pnpm test:focused -- src/foo.test.ts"
```

It prints `rtk`-prefixed fetch, duplicate-commit inspection, switch, rebase,
diff, and check commands, followed by manual merge/push/close steps. Add
`--old-base <commit>` when replaying a branch from an older base. Add `--run`
only after reviewing the plan; `--run` executes only non-manual steps. Issue
close planning is blocked unless at least one `rtk`-prefixed `--check` is
declared. `--base` remains a shorthand for `--base-branch`; use `--base-ref`
for the remote or commit used by duplicate inspection, rebase, and diff.

## Check Lanes

Fast local gates:

```bash
pnpm verify:changed # plan the smallest useful checks from changed files
pnpm verify:changed -- --profile edit --run
pnpm verify:changed -- --run
pnpm check:pre-push  # root/server typecheck + custom architectural lints
pnpm test:focused -- <changed tests>
pnpm test:repeat -- --count 5 <changed tests>
```

Full merge gate:

```bash
pnpm check:merge     # check:static + check:unit
```

`pre-push` intentionally runs the fast gate. Full unit, browser, packaging, and
Rust checks stay in CI and should also be run locally when the changed area
requires them.

`verify:changed` inspects committed changes against `origin/main`, unstaged
changes, staged changes, and untracked files. Pass explicit paths to plan a
change before editing:

```bash
pnpm verify:changed -- src/render/reference-render.ts
pnpm verify:changed -- --profile edit
pnpm verify:changed -- --profile full
```

Use `--profile edit` while actively changing code. It runs diff checks and
focused tests only, then reminds you which broader gates were skipped. Use the
default quick profile before push, and full before closing broad/high-risk
issues.

Use `test:repeat` before closing intermittent or order-sensitive test issues:

```bash
pnpm test:repeat -- --count 5 src/editor/list-outliner.test.ts
pnpm test:repeat -- --shuffle --count 10 src/a.test.ts src/b.test.ts
```

Runtime quick lanes:

```bash
pnpm test:browser:quick                # merged-app smoke
pnpm test:browser:quick -- render      # headings/math/index rich render
pnpm test:browser:quick -- scroll      # scroll-jump focused lane
pnpm test:browser:quick -- one headings math-render
```

Perf quick lanes are for local regression sniffing, not PR-quality perf claims:

```bash
pnpm perf:quick --scenario local-edit-index
pnpm perf:quick:heavy --scenario typing-rich-burst
```

## Closing Issues: Verification Record

Before closing an issue, post a verification record so reviewers can audit
that the visible behavior actually changed. Use `pnpm issue -- verify-close`
to write the comment and close in one step. The recommended template:

- **Commit**: SHA of the change (auto-included)
- **Verified**: list of commands run (`--verify "pnpm test"` may be repeated)
- **Browser/visual artifacts**: paths or links for runtime/visual issues
  (`--browser-artifact /tmp/coflat-foo.png`). Required for visual or runtime
  issues unless explicitly marked N/A in the message.
- **Residual risk**: known follow-ups or out-of-scope notes
  (`--residual-risk "..."`)

Example:

```
pnpm issue -- verify-close 1234 \
  --commit $(git rev-parse HEAD) \
  --verify "pnpm test" \
  --verify "pnpm test:browser:cm6-rich" \
  --browser-artifact /tmp/coflat-1234-before.png \
  --browser-artifact /tmp/coflat-1234-after.png \
  --residual-risk "Tauri smoke not run; covered separately in #1300"
```

For doc-only or non-runtime issues the artifact and residual-risk flags can be
omitted; verification commands alone are enough. This is a recommended
template — not a gate — so trivial closes still work without ceremony.

## Browser Verification Lanes

Canonical lanes for runtime verification. Pick the smallest lane that covers
the changed surface; escalate to `full` for broad or pre-merge work. The fast
default is `smoke` so routine fixes do not pay for unrelated coverage.

| Lane | Command | When required |
|---|---|---|
| smoke | `pnpm test:browser:quick -- smoke` | every browser-affecting change (fast default) |
| cm6-rich | `pnpm test:browser:cm6-rich` | render-layer / Typora-mode / fenced-div / math-render changes |
| scroll | `pnpm test:browser:scroll` | scroll, cursor-handoff, vertical-motion changes |
| navigation | `pnpm test:browser:navigation` | file open, mode switch, cursor navigation across blocks |
| media | `pnpm test:browser:media` | image, hover-preview, local-PDF changes |
| perf | `pnpm perf:quick --scenario <name>` | local regression sniff; not PR-quality evidence |
| full | `pnpm test:browser` | broad changes, pre-merge gate, anything touching shared editor state |

`pnpm verify:changed` recommends these lanes from changed paths. The
`authoring`, `visual`, and `export` lanes from earlier proposals are not yet
implemented; treat them as future work and use `full` for now.

## Focused Test Watchdog

`pnpm test:focused -- ...` runs each explicit test file in a single deterministic
worker lane and kills stalled child processes. Watchdog details live in
`docs/verification-workflows.md`.
