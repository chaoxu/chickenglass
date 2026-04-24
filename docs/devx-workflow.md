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

Worker agents must report:

```text
Issue: #1234
Branch: worker/issue-1234
Base: <commit or origin/main>
Changed paths:
- src/...

Verification:
- pnpm test:focused -- ...

Residual risk:
- ...
```

Use the merge helper to turn that report into a repeatable integration plan:

```bash
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
pnpm check:pre-push  # root/server typecheck + custom architectural lints
pnpm test:focused -- <changed tests>
```

Full merge gate:

```bash
pnpm check:merge     # check:static + check:unit
```

`pre-push` intentionally runs the fast gate. Full unit, browser, packaging, and
Rust checks stay in CI and should also be run locally when the changed area
requires them.

## Focused Test Watchdog

`pnpm test:focused -- ...` runs each explicit test file in a single deterministic
worker lane and kills stalled child processes. Watchdog details live in
`docs/verification-workflows.md`.
