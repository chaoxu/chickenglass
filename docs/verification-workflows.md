# Verification Workflows

Use these commands when you need automation-safe evidence instead of broad repo
defaults.

## Focused Render / State Verification

Use the single-worker Vitest lane for changed-area editor/render/state work. It
avoids worker-pool noise and cleans up its child process on exit.

```
pnpm test:focused -- src/lexical/markdown.test.ts
pnpm test:focused -- src/lexical/markdown.test.ts src/lexical/nodes/raw-block-node.test.ts
```

If an explicit test path does not exist, `pnpm test:focused` fails fast instead
of silently falling back to a broader Vitest run.

## Browser Regression Lane

Use the managed browser harness for runtime/editor flows:

```
pnpm dev:show
pnpm dev:show:hmr
pnpm test:browser -- --filter <name>
```

`pnpm dev:show` is a stable no-HMR review lane on `http://localhost:5173`.
Use `pnpm dev:show:hmr` for show-mode behavior with Vite HMR during fast
iteration. `pnpm preview` still requires rebuild/restart because it serves the
compiled bundle.

For held-key/auto-repeat coverage, do not use Playwright
`keyboard.down(); wait(); keyboard.up()` as a physical key-repeat simulation.
Playwright sends one keydown unless repeat events are dispatched explicitly.
Use CDP `Input.dispatchKeyEvent` with repeated `keyDown` events and
`autoRepeat: true`; see the `key-repeat-input` browser regression.

### Browser Repro Harness

Capture, replay, and diff editor sessions:

```
# Capture current editor state after setup steps
node scripts/browser-repro.mjs capture \
  --fixture index.md \
  --mode lexical \
  --output /tmp/coflat-capture.json

# Replay a recorded debug session
node scripts/browser-repro.mjs replay \
  --session /tmp/coflat-debug/session.jsonl \
  --output /tmp/coflat-replay.json

# Diff two session recordings
node scripts/browser-repro.mjs diff \
  --left /tmp/coflat-debug/session-a.jsonl \
  --right /tmp/coflat-debug/session-b.jsonl
```

For manual browser or compiled-app bug reports, export the local session from
DevTools:

```
await __cfDebug.ready
JSON.stringify(__cfDebug.exportSession({ includeDocument: true }), null, 2)
```

Use `includeDocument: false` when you only want hashes, selection, excerpts,
and interaction events.

Run `node scripts/browser-repro.mjs --help` for the full step JSON format
reference.

## Heavy-Doc Perf Verification

Use heavy-doc perf mode for typing-rich and fixture-heavy scenarios:

```
pnpm perf:capture:heavy -- \
  --scenario typing-lexical-burst \
  --iterations 3 \
  --warmup 1 \
  --output output/perf/typing-lexical-burst-heavy.json
```

Compare against a baseline:

```
pnpm perf:compare:heavy -- \
  --scenario typing-lexical-burst \
  --baseline output/perf/typing-lexical-burst-heavy-baseline.json
```

The `--heavy-doc` flag (used implicitly by `perf:capture:heavy` and
`perf:compare:heavy`) increases settle times for large documents.
The default `typing-lexical-burst` scenario performs x100 insert bursts against
`demo/index.md` and the public redacted heavy fixture at
`demo/perf-heavy/main.md`.
