# Perf Regression Guide

Use `scripts/perf-regression.mjs` for repeatable browser-side measurements.

## Preferred fixtures

Fixture defaults live in `scripts/tooling-fixtures.mjs`; update that catalog
instead of editing perf scripts, browser regressions, or DevX status output
directly.

- Preferred heavy scroll/perf fixture: `fixtures/rankdecrease/main.md`
- Typing/perf semantic hotspot fixture: `fixtures/cogirth/main2.md`
- Public fallback: `demo/index.md`

## Common scenarios

- `open-index`
- `open-scroll-fixture`
- `mode-cycle-index`
- `typing-lexical-burst`
- `scroll-step-lexical`
- `scroll-step-source`

## Example

```bash
pnpm dev
node scripts/perf-regression.mjs capture --scenario typing-lexical-burst --output /tmp/coflat-perf.json
node scripts/perf-regression.mjs compare --scenario typing-lexical-burst --baseline /tmp/coflat-perf.json
```

## Requirements

- Report before/after numbers on a real document.
- Note when a private fixture was unavailable and a public fallback was used.
- Keep scenario names and required metrics stable when possible so old baselines remain comparable.
