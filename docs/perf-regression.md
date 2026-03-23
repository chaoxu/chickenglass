# Perf Regression Workflow

Coflat already records frontend spans in `src/app/perf.ts` and backend spans in the Tauri perf state. This workflow turns those live counters into a repeatable regression check.

## What It Does

- connects to the existing Chrome for Testing app over CDP
- reloads the app between iterations so each run starts from the same state
- clears frontend + backend perf counters before each measured run
- runs a built-in scenario
- captures the aggregated perf snapshot from `window.__cfDebug.perfSummary()`
- saves a baseline JSON or compares a new run against a baseline

## Prerequisites

Start the app in the usual dev browser lane:

```bash
npm run dev -- --host 127.0.0.1 --port 5173
npm run chrome -- --url http://127.0.0.1:5173 --port 9322
```

The perf script reuses that running Chrome for Testing instance.

## Capture a Baseline

```bash
npm run perf:capture -- \
  --scenario open-index \
  --iterations 3 \
  --warmup 1 \
  --output output/perf/open-index.json
```

## Compare Against a Baseline

```bash
npm run perf:compare -- \
  --scenario open-index \
  --iterations 3 \
  --warmup 1 \
  --baseline output/perf/open-index.json
```

If the current run exceeds the configured thresholds, the command exits non-zero.

## Built-In Scenarios

- `open-index`
  Reload app, open `index.md` in Rich mode.
- `open-heavy-post`
  Reload app, open `posts/2020-07-11-yotta-savings-and-covering-designs.md`.
- `mode-cycle-index`
  Reload app, open `index.md`, then cycle `Source -> Read -> Rich`.

## Thresholds

Defaults:

- threshold: `25%`
- minimum absolute delta: `5 ms`

Override them when needed:

```bash
npm run perf:compare -- \
  --scenario open-heavy-post \
  --baseline output/perf/open-heavy-post.json \
  --threshold-pct 15 \
  --min-delta-ms 8
```

## Notes

- Reloading between iterations is intentional. It avoids “second open just activates an existing tab” noise.
- The baseline format is versioned. If the report format changes, old baselines will fail fast instead of comparing garbage.
- This is meant for trend detection, not absolute benchmarking. Keep the same machine, browser profile, port, and scenario when comparing results.
