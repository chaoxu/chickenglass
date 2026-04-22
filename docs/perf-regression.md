# Perf Regression Workflow

Coflat already records frontend spans in `src/app/perf.ts` and backend spans in the Tauri perf state. This workflow turns those live counters into a repeatable regression check.

## What It Does

- launches a Playwright-owned Chromium by default
- reloads the app between iterations so each run starts from the same state
- clears frontend + backend perf counters before each measured run
- runs a built-in scenario
- asserts basic editor/semantics health after the scenario settles
- captures the aggregated perf snapshot from `window.__cfDebug.perfSummary()`
- validates any scenario-required metrics before writing or comparing a report
- saves a baseline JSON or compares a new run against a baseline

## Prerequisites

Start the app server:

```bash
pnpm dev
```

The perf script owns its browser session by default. If you need to compare against the manual app window, pass `--browser cdp` and launch `pnpm chrome` separately.

For heavy private fixtures, use the supported heavy-doc mode instead of ad hoc timeout tweaks:

```bash
pnpm perf:capture:heavy -- --scenario typing-rich-burst --output output/perf/typing-rich-burst-heavy.json
```

## Capture a Baseline

```bash
pnpm perf:capture -- \
  --scenario open-index \
  --iterations 3 \
  --warmup 1 \
  --output output/perf/open-index.json
```

## Compare Against a Baseline

```bash
pnpm perf:compare -- \
  --scenario open-index \
  --iterations 3 \
  --warmup 1 \
  --baseline output/perf/open-index.json
```

If the current run exceeds the configured thresholds, the command exits non-zero.

## Supported Heavy-Doc Mode

`typing-rich-burst` and other fixture-heavy scenarios should use `--heavy-doc` (or the `perf:capture:heavy` / `perf:compare:heavy` scripts) for automation. Heavy-doc mode raises:

- debug-bridge timeout to `45000ms`
- fixture-open verification timeout to `45000ms`
- post-open settle to `800ms`

Equivalent explicit command:

```bash
pnpm perf:capture -- \
  --scenario typing-rich-burst \
  --heavy-doc \
  --iterations 3 \
  --warmup 1 \
  --output output/perf/typing-rich-burst-heavy.json
```

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
  Reload rich documents and measure typing bursts across deterministic anchors. The suite keeps the existing plain-prose positions in `demo/index.md` and, when local private fixtures are available, also measures `fixtures/rankdecrease/main.md` plus semantic hotspots in `fixtures/cogirth/main2.md` (`inline_math`, `citation_ref`, and prose positions). If any required typing metric disappears or is emitted for fewer than the measured iterations, the benchmark fails immediately.
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
pnpm perf:compare -- \
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

The `scroll-step-rich`, `scroll-jump-rich`, and `scroll-step-source` scenarios prefer a heavy mathematical document (`fixtures/cogirth/main2.md`) when that local private fixture is available. Otherwise use the public `demo/index.md` baseline and note the limitation.

### Example: compare Rich vs Source stepped scroll

```bash
pnpm perf:capture -- --scenario scroll-step-rich \
  --output output/perf/scroll-step-rich.json

pnpm perf:capture -- --scenario scroll-step-source \
  --output output/perf/scroll-step-source.json
```

### Example: detect scroll regression

```bash
# Capture baseline on the current build
pnpm perf:capture -- --scenario scroll-step-rich \
  --iterations 5 --warmup 2 \
  --output output/perf/scroll-step-rich-baseline.json

# After changes, compare
pnpm perf:compare -- --scenario scroll-step-rich \
  --iterations 5 --warmup 2 \
  --baseline output/perf/scroll-step-rich-baseline.json
```

The scroll scenarios report custom metrics alongside the usual frontend/backend span summaries:

- **Stepped scroll** (`scroll-step-rich`, `scroll-step-source`): `scroll.step_count`, `scroll.mean_step_ms`, `scroll.max_step_ms`, `scroll.total_ms`
- **Jump scroll** (`scroll-jump-rich`): `scroll.cold_jump_ms`, `scroll.warm_back_ms`, `scroll.warm_forward_ms`

Per-step timing uses `performance.now()` around each synchronous `view.dispatch()` call, so values measure the CM6 update/render cost directly. A 16 ms `setTimeout` between steps yields the event loop without blocking on `requestAnimationFrame` (which stalls in non-interactive CDP windows). Comparing Rich vs Source isolates rendering overhead. The `--min-delta-ms` threshold applies to ms-valued scroll metrics the same way it applies to frontend/backend spans.

You can override the supported heavy-doc budgets with `--debug-timeout-ms`, `--open-timeout-ms`, and `--post-open-settle-ms` when a fixture needs different automation limits.

## Runtime Latency Budgets

Runtime latency is the performance budget that matters for editor work. Bundle size is a packaging guardrail only; the standalone editor JS limit is intentionally generous at 10 MB so local optimization work stays focused on open, typing, mode-switch, semantic-analysis, and scroll latency.

Use these default targets when filing or closing performance issues:

- Typing bursts in Rich mode should keep per-edit render and semantic hot-path spans under a single frame budget on the preferred heavy fixture.
- Stepped and jump scroll scenarios should not regress Rich mode against its own baseline, and Source mode should remain the comparison lane for isolating Rich rendering overhead.
- Open and mode-switch scenarios should include both total scenario time and the largest frontend/backend spans in the report.
- Any exception to these targets needs before/after numbers and a concrete reason, not a bundle-size argument.

## Notes

- Reloading between iterations is intentional. It avoids state bleed between runs.
- The baseline format is versioned. If the report format or required-metric contract changes, old baselines will fail fast instead of comparing garbage.
- This is meant for trend detection, not absolute benchmarking. Keep the same machine, browser profile, port, and scenario when comparing results.
