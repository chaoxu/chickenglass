# Subsystem Pattern

This document captures the subsystem pattern that has emerged in Coflat's
successful refactors. It exists to keep complex features from sliding back
into mixed files that own state, rendering, and side effects all at once.

## When something is a subsystem

A feature should be treated as a subsystem instead of a helper or component
once it has more than one of these properties:

- its own non-trivial state or invariants
- multiple render targets or adapters
- asynchronous or platform side effects
- more than one caller needing the same policy
- a history of regressions caused by ownership being spread across files

Examples that clearly qualify:

- editor session / tabs
- search
- document fragment surfaces
- theme contract and application
- references / citations / crossrefs
- complex interactive editors such as tables

A feature should usually stay a helper or component when it is:

- pure presentation over already-settled state
- a small stateless transform
- a narrow adapter to a well-owned subsystem

## Default subsystem shape

Not every subsystem needs every layer, but the default shape should be:

1. model
2. controller
3. render adapter(s)
4. side-effect layer
5. invariant-focused tests

### 1. Model

Owns the typed data shape and the language of the concept.

Questions the model should answer:

- what is the canonical state?
- what invariants must always hold?
- what are the named entities the rest of the app reasons about?

Examples:

- a tab/session state object
- a search query + active match state
- a document fragment descriptor
- a theme token map

### 2. Controller

Owns transitions and policy.

Questions the controller should answer:

- what intents exist?
- how does state change in response?
- what rules are policy, not just presentation?

Examples:

- `openPreview`, `pin`, `close`, `reorder`
- `setQuery`, `nextMatch`, `replaceAll`
- `renderDocumentFragmentToDom`

Controllers should prefer pure transitions when possible.

### 3. Render adapter(s)

Own the translation from subsystem state into a specific UI target.

Render adapters should not rediscover policy that belongs in the controller.

Examples:

- CM6 widget/decorations
- React view components
- Pandoc export output
- tooltip or chrome-label rendering

### 4. Side-effect layer

Owns I/O, platform, or environment coupling.

Examples:

- Tauri command calls
- filesystem operations
- DOM event glue
- timers, observers, browser APIs

The side-effect layer should call into the controller/model, not replace it.

### 5. Invariant-focused tests

Tests belong at the seam where the subsystem's rules can fail.

Preferred test shapes:

- pure model/controller tests for invariants
- structural migration tests for architecture boundaries
- narrow adapter tests for critical rendering contracts

Avoid relying only on a large integration test when the subsystem has an
isolatable rule set.

## Owner per concept

Each concept should have one obvious owner.

If a concept cannot answer "what file or module owns the rules?" it is already
starting to leak.

Current owner rules:

- one owner for search state and match policy
- one owner for tab/session policy
- one owner for theme token contract
- one owner for document-fragment surface rendering
- one owner for semantic document analysis

UI components should consume those owners, not redefine the same concept.

## Neutral owner for cross-subsystem state

If a selector, type, or model is used by more than one subsystem, it no
longer belongs inside one subsystem's internal module. `src/state/` is the
neutral owner for shared editor/document state.

Use `src/state/` for:

- CM6 `StateField`s and helpers consumed by more than one subsystem
- selectors and typed models that more than one subsystem needs to reason
  about
- document state that must be shared without creating renderer -> plugin,
  adapter -> effect, or peer-subsystem imports

Import direction rule:

- subsystems may consume `src/state/`
- `src/state/` may compose lower-level semantics/model modules
- a subsystem must not define state for another subsystem or make peers
  import from its internal module just to reach shared state
- if a consumer needs one concept, import the owner module directly
- if a consumer needs several state owners together, add a focused
  `src/state/<use-case>-state.ts` composition module instead of a broad barrel

Concrete Epic 2 moves already in the repo:

- `src/state/document-analysis.ts` moved semantic document analysis to a
  neutral owner used by editor, render, citations, and semantics helpers
- `src/state/code-block-structure.ts` moved fenced-code structure out of
  renderer/protection ownership into a shared state module
- `src/state/plugin-registry.ts` made plugin registry state consumable from
  editor, render, semantics, and plugins without leaving CM6 ownership inside
  `src/plugins/`
- `src/state/cm-structure-edit.ts` and `src/state/shell-ownership.ts` keep
  shared editor/render structure-edit and active-shell selectors out of either
  peer subsystem

See [Document State Module](./document-state-module.md) for the canonical
selector, composition, and registry rules.

## Subsystem checklist

Before adding or refactoring a complex feature, ask:

1. What is the model?
2. What owns transitions?
3. What are the render adapters?
4. What side effects exist?
5. Where are the invariants tested?
6. Is this creating a second code path for an existing concept?
7. What old path can be deleted after the new owner exists?

If several answers are "the component does a bit of everything", the feature
is probably missing a subsystem boundary.

## Cross-layer rules

Preferred:

- parser/syntax -> semantics -> render adapters
- pure transitions -> effects
- one concept owner -> multiple views

Avoid:

- renderers reparsing or rediscovering semantics ad hoc
- components directly performing policy + I/O + view assembly together
- multiple partial owners for one concept
- keeping legacy code paths alive after the new owner exists

## Current hotspot map

These are the remaining areas that should be judged against this pattern. When
they need selectors/types/models shared across subsystem boundaries, move that
state into `src/state/`, the neutral owner, instead of parking it under one of
the consumers:

- search
- tabs/session
- document fragment surfaces
- theme contract
- reference/citation/crossref integration

When these areas are changed, the goal is not just to make the code shorter.
The goal is to make the owner, transitions, adapters, and invariants explicit.
Shared CM6 document state for those areas belongs in `src/state/` per
[Document State Module](./document-state-module.md).
Shared CM6 document state for those areas belongs in `src/state/` per
[Document State Module](./document-state-module.md).

## Good subsystem examples in the repo

- `src-tauri/src/commands/*` split by domain
- table stack split into discovery/actions/navigation/widget/assembly
- app shell split into workspace/editor/overlay hooks
- file tree built around a dedicated Headless Tree controller

These are the patterns to copy when building the next subsystem.
