# Document State Module

`src/state/` is coflat2's neutral owner for editing and document state that more
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

1. **owner modules** — one concept each: `editor-focus.ts`, `structure-edit.ts`,
   `inline-source.ts`
2. **use-case composition modules** — bundle several owners for one consumer:
   `editing-surface.ts`
3. **consumer modules** — import the composition module instead of reaching into
   individual owners

Owner modules keep one concept local and canonical. Composition modules bundle
several owner modules for one consumer. Consumers should import the composition
module when they need a stable multi-field snapshot or shared invalidation
logic.

## Registry Rule

Do not add a broad `src/state/index.ts` barrel that re-exports every type.

That shape looks convenient at first, but it hides which concepts a consumer
actually depends on and makes unrelated state easy to import together. It also
turns `src/state/` into "everything from everywhere" instead of preserving one
owner per concept.

Preferred import rules:

- if a consumer needs one concept, import the owner module directly
- if a consumer needs several state owners together, add a small
  `src/state/<use-case>-state.ts` composition module
- keep the composition module focused on one caller or one closely-related
  family of callers

## Selector Conventions

For Lexical-based editors, "selectors" are typed read functions that extract
state from the editor or React context.

- single-owner reads can stay inline or in the owner module
- reusable derived reads for one owner belong in that owner's `src/state/*`
  file
- multi-owner reads belong in a use-case composition module under `src/state/`
- change-detection helpers and equality functions should live next to the types
  they support

Composition modules may depend on state owners and pure helpers. They must not
depend on render/editor DOM adapters or other subsystem side-effect layers.

## When State Lives In `src/state/`

Move state to `src/state/` when any of these are true:

- more than one subsystem imports it
- it describes canonical document/config/render state, not a widget-local cache
- another subsystem needs its types, selectors, or invalidation rules

Keep state inside a subsystem when all of these stay true:

- only one subsystem uses it
- the state is private implementation detail
- the state is view-lifecycle, DOM, or widget-session data rather than shared
  document state

## Adaptation from coflat v1

coflat v1 used CM6 `StateField`s as the primary state container. coflat2 uses
Lexical, which does not have an equivalent first-class state mechanism. The
neutral owner pattern adapts as follows:

| coflat v1 (CM6)           | coflat2 (Lexical)                           |
|---------------------------|---------------------------------------------|
| `StateField<T>`           | Pure TypeScript types + React context/store  |
| `state.field(myField)`    | Context read or store selector               |
| `createChangeChecker()`   | Equality functions on state types             |
| Transaction-based updates | `editor.update()` with tags + React setState  |

The principles are the same: one owner per concept, explicit composition for
multi-concept consumers, no broad barrels.

## Example Pattern

`src/state/editing-surface.ts` is the canonical composition example.

It composes:

- editor focus ownership (`editor-focus.ts`)
- structure-edit mode (`structure-edit.ts`)
- inline source activation (`inline-source.ts`)

That module exposes:

- one `EditingSurfaceState` type for consumers
- a change-detection helper (`isEditingSurfaceChanged`)
- idle defaults (`EDITING_SURFACE_IDLE`)

Consumers import one composition module instead of reaching into three separate
state owners.
