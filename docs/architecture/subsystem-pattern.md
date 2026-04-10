# Subsystem Pattern

Use a clear seam for non-trivial features:

1. **Model**: pure data and state transitions
2. **Controller**: orchestration, async work, integration with the app shell
3. **Surface adapter**: React, Lexical, or export-facing wiring

Rules:

- One concept has one owner.
- Shared selectors/types move into a neutral module.
- Keep editor-surface code thin; push reusable logic into pure modules first.
- Prefer explicit controller methods over scattered refs/effects.
