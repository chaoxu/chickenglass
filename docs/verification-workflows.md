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
pnpm test:browser -- --filter <name>
```

`pnpm dev:show` is a stable no-HMR review lane on `http://localhost:5173`.

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
  --scenario typing-rich-burst \
  --iterations 3 \
  --warmup 1 \
  --output output/perf/typing-rich-burst-heavy.json
```

Compare against a baseline:

```
pnpm perf:compare:heavy -- \
  --baseline output/perf/typing-rich-burst-heavy-baseline.json \
  --current output/perf/typing-rich-burst-heavy.json
```

The `--heavy-doc` flag (used implicitly by `perf:capture:heavy` and
`perf:compare:heavy`) increases settle times for large documents.
