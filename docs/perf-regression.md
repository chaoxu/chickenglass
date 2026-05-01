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

Native scenarios do not use the browser or app server. `html-export-pandoc` runs local Pandoc directly and preflights both `pandoc` and `pandoc-crossref` before measurement.

Each capture prints an "Actionable summary" before the raw span tables. It
combines the largest frontend/backend spans and the largest ms-valued scenario
metrics, then attaches a stable bucket and likely owner path for common metric
families. Use that table first when deciding where the next optimization should
start. Compare runs also attach the same bucket/owner hints to regressed or
missing measurements.

Typing and scroll captures also print a "Performance answer table" before the
actionable summary. This is the short table to use when someone asks "how fast
is typing or scrolling right now?" For `typing-rich-burst`, the key columns are
`dispatchP95Ms` for normal synchronous per-character dispatch cost and
`donePerCharP95Ms` for the end-to-idle burst cost normalized per character. The
same rows are saved as `answerTable` in the JSON report when `--output` is set.

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

CI uses compare mode as the gate only when it can build a distinct baseline
ref. Pull requests compare the candidate build against the target branch; push
runs compare against the previous commit when available. If no distinct
baseline ref exists, CI records a capture-only diagnostic artifact instead of
presenting a same-build comparison as a regression check.

## Supported Heavy-Doc Mode

`typing-rich-burst` and other fixture-heavy scenarios should use `--heavy-doc`
(or the `perf:capture:heavy` / `perf:compare:heavy` scripts) for automation.
Heavy-doc mode selects the `heavy-doc` runtime budget profile from
`scripts/runtime-budget-profiles.mjs`; the normal browser/perf lane uses the
`default` profile.

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

- `html-export-pandoc`
  Run the native Pandoc-backed HTML export path against `demo/index.md` and, when available, `fixtures/cogirth/main2.md`. This scenario skips Vite/Playwright, copies each fixture into `/tmp/coflat-*`, invokes Pandoc with the same HTML argument shape as `src-tauri/src/commands/export.rs`, and reports `export.html.wall_ms`, `export.html.input_bytes`, and `export.html.output_bytes` for each fixture.
- `open-index`
  Reload app, open `index.md` in Rich mode.
- `open-heavy-post`
  Reload app, open `posts/2020-07-11-yotta-savings-and-covering-designs.md`.
- `mode-cycle-index`
  Reload app, open `index.md`, then cycle between Rich and Source modes.
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

## Typing Metrics

`typing-rich-burst` is a stress benchmark, not a literal single-keystroke
measurement. Each measured position inserts `100` one-character edits through
back-to-back editor dispatches, then waits for render/idle settling. The total
burst size is emitted as `typing.insert_count`.

The main CM6 typing metrics are:

- `typing.dispatch_mean_ms` / `typing.dispatch_p95_ms` / `typing.dispatch_max_ms`
  measure the synchronous CM6 `view.dispatch()` cost for each inserted
  character inside the burst.
- `typing.wall_ms` measures the wall-clock time for the full 100-character
  burst loop.
- `typing.settle_ms` waits for two animation frames after the burst.
- `typing.idle_ms` waits for `requestIdleCallback` (or a zero-delay timeout
  fallback).
- `typing.input_to_idle_ms` is `wall_ms + settle_ms + idle_ms` for the whole
  burst. This is the best end-to-end "the editor is done reacting" number, but
  it is not a single-character latency.
- `typing.wall_per_char_ms` and `typing.input_to_idle_per_char_ms` normalize
  the burst totals by `typing.insert_count` so changes are easier to compare.
- `typing.span_total_ms.<span>.<case>.<position>` and
  `typing.span_count.<span>.<case>.<position>` are measured immediately around
  each typing burst. Use these for attribution; the top-level frontend span
  table can also include document-open/setup work from the scenario.
- `typing.longtask_*` reports browser Long Tasks during the burst plus normal
  settle/idle waits. Long Tasks are main-thread blocks of roughly 50ms or more.
- `typing.post_idle_*` observes the first 500ms after the editor reports idle.
  Post-idle long tasks or high `post_idle_lag_*` frame-cadence lag indicate CPU
  work is still trapped after the user has stopped typing.

Use p95 numbers when judging typing feel. Mean hides sticky edits; max can be a
single scheduling outlier. p95 is usually the best "bad but normal keystroke"
signal.

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

You can override the selected runtime budget profile with `--debug-timeout-ms`,
`--open-timeout-ms`, `--post-open-settle-ms`, `--poll-interval-ms`,
`--idle-settle-timeout-ms`, `--document-stable-timeout-ms`,
`--sidebar-ready-timeout-ms`, `--sidebar-publish-timeout-ms`,
`--typing-canonical-timeout-ms`, `--typing-visual-sync-timeout-ms`, and
`--typing-semantic-timeout-ms` when a fixture needs different automation limits.

## HTML Export Scenario

Use `html-export-pandoc` for export latency measurements without faking Tauri/browser state:

```bash
pnpm perf:capture -- \
  --scenario html-export-pandoc \
  --iterations 3 \
  --warmup 1 \
  --output output/perf/html-export-pandoc.json
```

The scenario renders its command from `src/latex/export-contract.json` and runs:

- `pandoc --version`
- `pandoc-crossref --version`
- `pandoc --from=markdown+fenced_divs+raw_tex+grid_tables+pipe_tables+tex_math_dollars+tex_math_single_backslash+mark --to=html5 --standalone --wrap=preserve --katex --section-divs --filter=pandoc-crossref --citeproc --metadata=link-citations=true --resource-path=<source-dir[:project-root]> --output=<temp-output>`

Fixture markdown is copied to a temporary `/tmp/coflat-html-export-perf-*` project and sent to Pandoc over stdin, matching the Tauri export command shape. The reported `wall_ms` measures the Pandoc process only; fixture copying and preflight are outside the timed section. `input_bytes` and `output_bytes` are emitted as scenario metrics so export size changes appear alongside timing changes.

## Runtime Latency Budgets

Runtime latency is the performance budget that matters for editor work. Bundle size is a packaging guardrail only; the standalone editor JS limit is intentionally generous at 10 MB so local optimization work stays focused on open, typing, mode-switch, semantic-analysis, and scroll latency.

Use these default targets when filing or closing performance issues:

- Typing bursts in Rich mode should keep per-edit render and semantic hot-path spans under a single frame budget on the preferred heavy fixture.
- Stepped and jump scroll scenarios should not regress Rich mode against its own baseline, and Source mode should remain the comparison lane for isolating Rich rendering overhead.
- Open and mode-switch scenarios should include both total scenario time and the largest frontend/backend spans in the report.
- Any exception to these targets needs before/after numbers and a concrete reason, not a bundle-size argument.

## Dashboard Snapshot

`pnpm perf:dashboard` runs the existing `typing-rich-burst` capture and emits a
single flat JSON snapshot suitable for pasting into issues or PRs. The output
field order is sorted; the metrics object is keyed by metric base name with the
worst-hotspot value aggregated across all (case, position) pairs.

```bash
pnpm perf:dashboard                              # JSON to stdout
pnpm perf:dashboard --output snapshot.json       # JSON to file (status to stderr)
pnpm perf:dashboard --input report.json          # derive from an existing capture
```

The dashboard automatically passes `--heavy-doc` when
`fixtures/cogirth/main2.md` is present, falling back to `demo/index.md` and
recording the selection in the `fixture` field. Top-level fields:

- `capturedAt`, `commit`, `fixture`, `iterations`, `scenario`, `warmup`
- `metrics` — flat object: `typing.dispatch_p95_ms`, `typing.dispatch_max_ms`,
  `typing.input_to_idle_ms`, `typing.longtask_count`,
  `typing.post_idle_lag_p95_ms`, etc.

Idle CPU is intentionally not in the metric set — `perf-regression-lib.mjs`
does not capture an idle-CPU sample today, only the post-idle long-task and
frame-cadence-lag proxies, which the dashboard reports under `typing.post_idle_*`.

## Perf Gate

`pnpm perf:gate` captures a fresh dashboard snapshot and compares it against
the checked-in `perf-baseline.json` using a per-metric **1.5x** ratio threshold
plus the existing `--min-delta-ms` floor (default 5 ms). Count-style metrics
use a `--min-delta-count` floor of 1 instead.

```bash
pnpm perf:gate                                              # gate fresh capture
pnpm perf:gate --current snapshot.json                      # gate a saved snapshot
pnpm perf:gate --threshold-multiplier 1.3 --min-delta-ms 8  # tighten the gate
pnpm perf:gate --soft                                       # always exit 0 (CI soft mode)
pnpm perf:gate --json                                       # machine-readable output
```

The failing output names the scenario, fixture, metric, baseline value,
current value, and threshold for every regression. CI runs the gate in soft
mode (warn-only) so we can tighten it after collecting a few healthy
baselines.

### Regenerating the baseline

```bash
pnpm perf:dashboard --output perf-baseline.json
```

Commit the result. The baseline file embeds a `_descriptions` map alongside
the metrics for documentation; the gate ignores that field. Baselines are
machine-specific — regenerate on the target lane (CI runner or your laptop)
when you change scenarios, runtime budgets, or fixture content.

### Threshold policy

- Ratio gate: 1.5x of baseline (per metric). Designed to flag clear
  regressions while tolerating run-to-run noise.
- Absolute floor: 5 ms for ms-valued metrics, 1 for count-valued metrics. A
  small relative blow-up on a tiny baseline (e.g. 4 ms -> 7 ms) does not
  flap.
- Diagnostic-only metrics (e.g. raw long-task counts on quiet machines) can
  be tuned by editing `COUNT_METRICS` in `scripts/perf-gate-lib.mjs`.

## Notes

- Reloading between iterations is intentional. It avoids state bleed between runs.
- The baseline format is versioned. If the report format or required-metric contract changes, old baselines will fail fast instead of comparing garbage.
- This is meant for trend detection, not absolute benchmarking. Keep the same machine, browser profile, port, and scenario when comparing results.
