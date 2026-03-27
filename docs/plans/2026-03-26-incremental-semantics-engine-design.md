# Incremental Semantics Engine Design

**Goal:** Replace the current full-document `documentAnalysisField` rebuild path with a lightweight incremental engine that preserves semantic object identity for unchanged regions, supports local merge and tail propagation, and keeps the public `DocumentAnalysis` API stable for existing consumers.

**Status:** Approved for planning on March 26, 2026.

## Problem

Today [documentAnalysisField](/Users/chaoxu/playground/coflat/src/semantics/codemirror-source.ts#L34) recomputes a fresh whole-document semantic bundle whenever `tr.docChanged` or the syntax tree identity changes. [analyzeDocumentSemantics](/Users/chaoxu/playground/coflat/src/semantics/document.ts#L694) does one full `tree.iterate()` pass plus a full-text narrative-reference scan, and returns fresh arrays and maps for every slice.

That shape is simple but too coarse for edit-time rendering:

- unchanged semantic objects are recreated instead of mapped
- downstream fields/plugins often rebuild from whole-analysis identity changes
- local edits fan out into unrelated math, references, fenced blocks, and counters

The parser is already incremental. The semantics layer currently discards that locality.

## Non-Negotiable Constraints

1. Lightweight

- no retained patch log
- no per-node cache tables
- no mini reactive framework
- only one previous analysis snapshot is retained

2. Shared extraction pass

- do not replace [unifiedTreeWalk](/Users/chaoxu/playground/coflat/src/semantics/document.ts#L233) with one independent parser per slice
- each dirty window gets one tree walk that emits candidates for all slices

3. Stable public API

- existing consumers keep reading `DocumentAnalysis`
- internal state may become richer, but the public field contract stays source-compatible during rollout

4. Correctness over aggression

- any slice may fall back to global recompute when locality cannot be proven cheaply
- narrative references remain global fallback in v1

5. Deterministic phase order

- structural slices finalize before numbering slices
- numbering slices finalize before crossref/citation-dependent slices

## High-Level Architecture

The new engine lives behind [documentAnalysisField](/Users/chaoxu/playground/coflat/src/semantics/codemirror-source.ts#L34).

Instead of:

- `transaction -> analyze whole document -> publish fresh analysis`

it becomes:

- `transaction -> build delta -> expand dirty windows -> shared extraction -> slice merge -> tail propagation -> final assembly`

### Core Pieces

#### 1. `SemanticDelta`

A plain object derived from the transaction:

- changed ranges in old and new coordinates
- mapped-position helpers
- syntax-tree-changed flag
- frontmatter-changed flag
- global invalidators

This is an input envelope, not a retained graph.

#### 2. Dirty Windows

Raw changed ranges are coalesced and then expanded to safe semantic boundaries.

Examples:

- math edit -> containing math block or delimiter-safe window
- fenced-div edit -> containing fenced div or fence-safe window
- heading edit -> whole heading line
- footnote edit -> containing ref/def block

All windows are represented in absolute document offsets, not line numbers.

#### 3. Shared Window Extractor

For each dirty window, run one structural tree walk and emit:

- headings
- footnote refs
- footnote defs
- fenced divs
- equations
- math regions
- bracketed references
- exclusion ranges for later regex fallbacks

This preserves the current single-pass extraction invariant from [document.ts](/Users/chaoxu/playground/coflat/src/semantics/document.ts#L228).

#### 4. Slice Merge Engine

Each slice is handled by a small adapter. There are only two primary slice kinds:

- `local`
  - map old objects through `tr.changes`
  - replace overlapping objects in dirty windows
  - reuse unchanged objects
- `propagated`
  - do the same local merge
  - recompute derived tail state from the earliest affected object forward

Optional fallback:

- `global`
  - recompute the whole slice when local correctness is not cheap enough

#### 5. Final Assembly

Assemble a new analysis snapshot that:

- reuses unchanged object identities
- rebuilds lookup maps from the final arrays
- bumps a top-level revision and per-slice revisions only when that slice changes

## Internal Data Shape

Public `DocumentAnalysis` should remain close to the current type in [document.ts](/Users/chaoxu/playground/coflat/src/semantics/document.ts#L132).

Internally, the field should hold an enriched form:

```ts
interface IncrementalDocumentAnalysis extends DocumentAnalysis {
  readonly revision: number;
  readonly sliceRevisions: {
    readonly headings: number;
    readonly mathRegions: number;
    readonly fencedDivs: number;
    readonly equations: number;
    readonly references: number;
    readonly includes: number;
    readonly footnotes: number;
  };
  readonly meta: {
    readonly structural: StructuralState;
    readonly finalized: FinalizedState;
  };
}
```

`StructuralState` should carry only what the engine needs:

- ordered arrays with stable object identities
- minimal indexes such as `byFrom` or `byId`
- per-slice metadata needed to choose tail propagation start points

No interning tables and no multi-revision caches.

## Slice Taxonomy

### Local Slices

These should support map + local merge in v1:

- `mathRegions`
- `fencedDivs`
- `includes`
- bracketed `references`
- raw footnote refs and defs

### Propagated Slices

These need tail recompute after a local merge:

- heading numbering
- equation numbering
- footnote numbering

### Global Fallback Slices

These stay global in v1:

- narrative references from [collectNarrativeReferences](/Users/chaoxu/playground/coflat/src/semantics/document.ts#L548)

Rationale:

- current regex plus exclusion logic is boundary-sensitive
- local window extraction can miss cross-window matches
- correctness matters more than winning a few extra milliseconds in the first pass

## Phase Order

The update pipeline must be deterministic:

1. Build `SemanticDelta`
2. Expand dirty windows
3. Shared structural extraction for each dirty window
4. Structural merge
   - headings structure
   - footnote refs/defs
   - fenced divs
   - equations structure
   - math regions
   - bracketed refs
5. Local derivations
   - `includes`
   - `headingByFrom`
   - `equationById`
   - other direct indexes
6. Propagated finalization
   - heading numbers
   - equation numbers
   - footnote displayed order/numbers
7. Global fallback slices
   - narrative references
8. Final assembly

This ordering is required so code reading [crossref-resolver.ts](/Users/chaoxu/playground/coflat/src/index/crossref-resolver.ts#L63) or citation-dependent renderers never observe mismatched structure and numbering.

## Dirty Window Model

The engine should operate on affected windows, not whole-document passes and not individual syntax nodes.

For each transaction:

1. coalesce raw changed ranges
2. expand to safe semantic boundaries
3. map old objects through `tr.changes`
4. drop mapped objects that overlap dirty windows
5. splice in freshly extracted objects from those windows
6. run propagation from the earliest affected object where required

Examples:

- edit inside one `$...$`
  - replace one math region
  - no propagation
- insert a new heading near the top
  - replace local heading structure
  - renumber heading tail from first affected heading onward
- edit theorem body text
  - replace or preserve only the containing fenced div
  - no block-counter tail recompute unless class/id/order changed

## Renderer Implications

The engine is the primary invalidation source of truth. Renderers should stop inferring broad semantic changes from top-level analysis identity whenever slice revisions or slice identities are available.

That does not need to happen on day one. The rollout should be:

1. make the semantic field correct
2. then migrate hot consumers

Hot consumers to revisit after engine landing:

- [math-render.ts](/Users/chaoxu/playground/coflat/src/render/math-render.ts)
- [reference-render.ts](/Users/chaoxu/playground/coflat/src/render/reference-render.ts)
- [sidenote-render.ts](/Users/chaoxu/playground/coflat/src/render/sidenote-render.ts)
- [include-label.ts](/Users/chaoxu/playground/coflat/src/render/include-label.ts)
- [bibliography.ts](/Users/chaoxu/playground/coflat/src/citations/bibliography.ts)
- [block-counter.ts](/Users/chaoxu/playground/coflat/src/plugins/block-counter.ts)

## Adjacent Cleanup Required

At least one unrelated broad invalidator should be narrowed as part of this architecture work:

- [plugin-registry.ts](/Users/chaoxu/playground/coflat/src/plugins/plugin-registry.ts#L297) currently rebuilds on every `docChanged`

That field should depend on frontmatter block config changes, not arbitrary document edits.

Without that cleanup, block-rendering churn will remain broader than necessary even with an incremental semantics engine.

## Testing Strategy

Testing must cover both values and identity reuse.

### Correctness

- unchanged analysis slices remain semantically equal
- changed local objects are recomputed correctly
- numbering tails are recomputed from the correct start point
- narrative refs still behave correctly through global fallback
- syntax-tree-only updates still invalidate correctly

### Identity

- untouched math regions reuse object identity
- untouched fenced divs reuse object identity
- untouched includes reuse object identity
- unaffected heading prefix objects keep identity when only tail numbering changes

### Boundary Cases

- edits at math delimiters
- edits on fenced-div open/close fences
- incomplete fenced div trees
- heading insertion at top of document
- equation-label insertion before existing equations
- footnote ref reorder
- link/code/math edits that change narrative-ref exclusion zones

### Performance

Use the existing perf tooling in [docs/perf-regression.md](/Users/chaoxu/playground/coflat/docs/perf-regression.md) and related scripts after each major phase.

## Non-Goals for V1

- local incremental narrative-reference extraction
- renderer-local partial patching for every plugin
- replacing all existing slice consumers at once
- persistent caches across multiple revisions

## Rollout Summary

1. Build internal incremental engine and preserve public API
2. Land local slices first
3. Land propagated slices with deterministic phase order
4. Keep narrative references global fallback
5. Narrow unrelated broad invalidators
6. Migrate hot consumers to slice-aware invalidation after field correctness is established

This yields the cleanest architecture available without overbuilding a framework or sacrificing correctness.
