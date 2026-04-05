# Perf Regression Workflow

Coflat already records frontend spans in `src/app/perf.ts` and backend spans in the Tauri perf state. This workflow turns those live counters into a repeatable regression check.

## What It Does

- connects to the existing Chrome for Testing app over CDP
- reloads the app between iterations so each run starts from the same state
- clears frontend + backend perf counters before each measured run
- runs a built-in scenario
- asserts basic editor/semantics health after the scenario settles
- captures the aggregated perf snapshot from `window.__cfDebug.perfSummary()`
- validates any scenario-required metrics before writing or comparing a report
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
- `local-edit-index`
  Reload app, open `index.md`, then apply a local inline-math edit and report semantic revision churn.
- `typing-rich-burst`
  Reload rich documents and measure typing bursts across deterministic anchors. The suite keeps the existing plain-prose positions in `demo/index.md` and `demo/rankdecrease/main.md`, and explicitly adds semantic hotspots plus the canonical heavy fixture `demo/cogirth/main2.md` (`inline_math`, `citation_ref`, and prose positions). If any required typing metric disappears or is emitted for fewer than the measured iterations, the benchmark fails immediately.
- `scroll-step-rich`
  Reload app, open `cogirth/main2.md` in Rich mode, then scroll step-by-step (30 lines per step). Reports per-step timing metrics (`scroll.mean_step_ms`, `scroll.max_step_ms`).
- `scroll-jump-rich`
  Reload app, open `cogirth/main2.md` in Rich mode, then perform cold and warm jump scrolls (top-to-bottom, back-to-top, forward again). Reports `scroll.cold_jump_ms`, `scroll.warm_back_ms`, `scroll.warm_forward_ms`.
- `scroll-step-source`
  Same as `scroll-step-rich` but in Source mode. Useful as a baseline comparison for isolating Rich-mode rendering overhead.

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

For `local-edit-index`, the report also prints "Scenario metrics" with semantic
revision deltas and per-slice churn counts. That is the verification path for
edit-locality after the incremental semantics rollout.

All perf scenarios now run the shared `assertEditorHealth()` check from
`scripts/test-helpers.mjs` after settling and before the perf snapshot is
captured. That keeps the perf lane from passing when the editor is fast but the
debug bridge, selection bounds, syntax tree, or semantic revision info are
broken.

## Scroll Scenarios

The `scroll-step-rich`, `scroll-jump-rich`, and `scroll-step-source` scenarios measure scroll performance on a heavy mathematical document (`demo/cogirth/main2.md`). This fixture is committed to the repo and loaded via Vite's `import.meta.glob`.

### Example: compare Rich vs Source stepped scroll

```bash
npm run perf:capture -- --scenario scroll-step-rich \
  --output output/perf/scroll-step-rich.json

npm run perf:capture -- --scenario scroll-step-source \
  --output output/perf/scroll-step-source.json
```

### Example: detect scroll regression

```bash
# Capture baseline on the current build
npm run perf:capture -- --scenario scroll-step-rich \
  --iterations 5 --warmup 2 \
  --output output/perf/scroll-step-rich-baseline.json

# After changes, compare
npm run perf:compare -- --scenario scroll-step-rich \
  --iterations 5 --warmup 2 \
  --baseline output/perf/scroll-step-rich-baseline.json
```

The scroll scenarios report custom metrics alongside the usual frontend/backend span summaries:

- **Stepped scroll** (`scroll-step-rich`, `scroll-step-source`): `scroll.step_count`, `scroll.mean_step_ms`, `scroll.max_step_ms`, `scroll.total_ms`
- **Jump scroll** (`scroll-jump-rich`): `scroll.cold_jump_ms`, `scroll.warm_back_ms`, `scroll.warm_forward_ms`

Per-step timing uses `performance.now()` around each synchronous `view.dispatch()` call, so values measure the CM6 update/render cost directly. A 16 ms `setTimeout` between steps yields the event loop without blocking on `requestAnimationFrame` (which stalls in non-interactive CDP windows). Comparing Rich vs Source isolates rendering overhead. The `--min-delta-ms` threshold applies to ms-valued scroll metrics the same way it applies to frontend/backend spans.

## Notes

- Reloading between iterations is intentional. It avoids “second open just activates an existing tab” noise.
- The baseline format is versioned. If the report format or required-metric contract changes, old baselines will fail fast instead of comparing garbage.
- This is meant for trend detection, not absolute benchmarking. Keep the same machine, browser profile, port, and scenario when comparing results.
