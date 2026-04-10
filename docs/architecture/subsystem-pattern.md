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

## Neutral owner for cross-subsystem state

If a type, selector, or model is used by more than one subsystem, it belongs in
`src/state/`, the neutral owner for shared editing/document state.

Use `src/state/` for:

- typed models consumed by more than one subsystem
- equality and change-detection helpers that multiple consumers need
- document state that must be shared without creating renderer -> plugin,
  adapter -> effect, or peer-subsystem imports

Import direction rules:

- subsystems may consume `src/state/`
- `src/state/` may compose lower-level model modules
- a subsystem must not define state for another subsystem
- if a consumer needs one concept, import the owner module directly
- if a consumer needs several state owners together, use a focused
  `src/state/<use-case>-state.ts` composition module

Current state modules:

- `src/state/editor-focus.ts` — focus ownership (rich surface, source, structure edit)
- `src/state/structure-edit.ts` — structure-edit mode (which block, which variant)
- `src/state/inline-source.ts` — inline format source editing activation
- `src/state/editing-surface.ts` — composition of the above three

See [Document State Module](./document-state-module.md) for the canonical
selector, composition, and registry rules.
