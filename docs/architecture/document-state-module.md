# Document State Module

`src/state/` is Coflat's neutral owner for CodeMirror document state that more
than one subsystem consumes. This doc defines the shape that keeps that folder
from becoming an ad hoc grab bag.

## Goals

- keep one owner per document-state concept
- let render/editor/index subsystems consume shared state without reverse
  imports
- make "give me everything I need for rendering X" dependencies explicit
- avoid a broad registry that hides coupling

## Module layers

Use `src/state/` in three layers:

1. owner modules such as `document-analysis.ts`, `block-counter.ts`,
   `plugin-registry.ts`, `bib-data.ts`
2. use-case composition modules such as `reference-render-state.ts`
3. consumer modules such as `src/render/reference-render.ts`

Owner modules keep one concept local and canonical. Composition modules bundle
several owner modules for one consumer. Consumers should import the
composition module when they need a stable multi-field snapshot or shared
invalidation logic.

## Registry Rule

Do not add a broad `src/state/index.ts` barrel that re-exports every
StateField.

That shape looks convenient at first, but it hides which concepts a consumer
actually depends on and makes unrelated state easy to import together. It also
turns `src/state/` into "everything from everywhere" instead of preserving one
owner per concept.

Preferred import rules:

- if a consumer needs one concept, import the owner module directly
- if a consumer needs several document-state owners together, add a small
  `src/state/<use-case>-state.ts` composition module
- keep the composition module focused on one caller or one closely-related
  family of callers

## Selector Conventions

Selectors should live with the owner that has the rule they describe.

- single-owner reads can stay inline or in the owner module:
  `state.field(documentAnalysisField)`
- reusable derived reads for one owner belong in that owner's `src/state/*`
  file
- multi-owner reads belong in a use-case composition module under `src/state/`
- dependency signatures and `createChangeChecker(...)` bundles should live next
  to the selectors they support

Composition modules may depend on state owners and pure helpers. They must not
depend on render/editor DOM adapters or other subsystem side-effect layers.

## When State Lives In `src/state/`

Move a StateField to `src/state/` when any of these are true:

- more than one subsystem imports it
- it describes canonical document/config/render state, not a widget-local cache
- another subsystem needs its selectors, invalidation rules, or derived types

Keep a StateField inside a subsystem when all of these stay true:

- only one subsystem uses it
- the state is private implementation detail
- the state is view-lifecycle, DOM, or widget-session data rather than shared
  document state

## Example Pattern

`src/state/reference-render-state.ts` is the canonical example.

It composes:

- document analysis
- bibliography state
- block numbering
- plugin registry state

That module exposes:

- one `getReferenceRenderState(state)` read for the consumer
- shared dependency comparison helpers for rebuild/signature decisions

`src/render/reference-render.ts` then imports one state composition module
instead of reaching into four separate state owners. That is the preferred
shape for future "render X" or "index X" consumers.
