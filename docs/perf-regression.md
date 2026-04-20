# Perf Regression Guide

Use `scripts/perf-regression.mjs` for repeatable browser-side measurements.

## Preferred fixtures

Fixture defaults live in `scripts/tooling-fixtures.mjs`; update that catalog
instead of editing perf scripts, browser regressions, or DevX status output
directly.

- Public heavy scroll/perf fixture: `demo/perf-heavy/main.md`
- Public fallback: `demo/index.md`

Regenerate the public heavy fixture with
`node scripts/generate-public-heavy-fixture.mjs --source <private-main.md> --bib <private-ref.bib>`.
The generator preserves math and editor structure, remaps citations/labels, and
redacts non-math prose.

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
- The required typing burst gate uses the public heavy fixture so clean worktrees
  and CI do not depend on private local documents.
- Keep scenario names and required metrics stable when possible so old baselines remain comparable.
