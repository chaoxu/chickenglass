# Verification Workflows

Use these commands when you need automation-safe evidence instead of the broad repo defaults.

## Focused Render / State Verification

Use the single-worker Vitest lane for changed-area editor/render/state work. It avoids worker-pool noise, runs explicit test files one at a time, and cleans up its child process on exit.

```bash
pnpm test:focused -- src/render/sidenote-render.test.ts
pnpm test:focused -- src/render/reference-render.test.ts
pnpm test:focused -- src/render/hover-preview.test.ts src/render/hover-preview.render.test.ts
```

The supported automation-safe combined command for the current render/state hotspots is:

```bash
pnpm test:focused -- \
  src/render/sidenote-render.test.ts \
  src/render/reference-render.test.ts \
  src/render/hover-preview.test.ts \
  src/render/hover-preview.render.test.ts
```

If automation is handed an explicit test path that does not exist, `pnpm test:focused -- ...` now fails fast instead of silently falling back to a broader Vitest run.

The wrapper has run and inactivity watchdogs so hung test workers do not trap
automation. Override only while debugging a known slow case; a value of `0`
disables that timer for the current command:

```bash
FOCUSED_VITEST_TIMEOUT_MS=600000 pnpm test:focused -- src/render/reference-render.test.ts
FOCUSED_VITEST_INACTIVITY_TIMEOUT_MS=300000 pnpm test:focused -- src/render/reference-render.test.ts
```

## Browser Regression Lane

Use the managed browser harness for runtime/editor flows:

```bash
pnpm dev:show
pnpm test:browser -- --filter <name>
```

`pnpm dev:show` is the stable no-HMR review lane on `http://localhost:5173`.

## Heavy-Doc Perf Verification

Use the heavy-doc perf mode for `typing-rich-burst` and other fixture-heavy
scenarios. It selects the `heavy-doc` runtime budget profile from
`scripts/runtime-budget-profiles.mjs`; the normal browser/perf lane uses the
`default` profile.

```bash
pnpm perf:capture:heavy -- \
  --scenario typing-rich-burst \
  --iterations 3 \
  --warmup 1 \
  --output output/perf/typing-rich-burst-heavy.json
```

Compare against an existing baseline with the matching heavy-doc mode:

```bash
pnpm perf:compare:heavy -- \
  --scenario typing-rich-burst \
  --iterations 3 \
  --warmup 1 \
  --baseline output/perf/typing-rich-burst-heavy.json
```

If you need custom budgets, override the selected runtime budget profile with:

```bash
--heavy-doc
--debug-timeout-ms <n>
--open-timeout-ms <n>
--post-open-settle-ms <n>
--poll-interval-ms <n>
--idle-settle-timeout-ms <n>
--sidebar-publish-timeout-ms <n>
--typing-canonical-timeout-ms <n>
```

## Repo-Wide Typecheck

Use the explicit check command for root and server TypeScript coverage:

```bash
pnpm check:types
```

## Full Merge Gate

Use the full local merge gate before closing broad implementation or cleanup
issues:

```bash
pnpm check:merge
```

Use the fast pre-push lane for routine pushes:

```bash
pnpm check:pre-push
```
