# Verification Workflows

Use these commands when you need automation-safe evidence instead of the broad repo defaults.

## Focused Render / State Verification

Use the single-worker Vitest lane for changed-area editor/render/state work. It avoids worker-pool noise and cleans up its child process on exit.

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
```

## Repo-Wide Typecheck

Use the normal repo command now that the deprecated `baseUrl` blocker is gone:

```bash
pnpm typecheck
```
