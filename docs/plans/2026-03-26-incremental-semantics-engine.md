# Incremental Semantics Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace whole-document semantic recomputation with a lightweight incremental `documentAnalysisField` engine that reuses unchanged semantic objects, supports local merge and tail propagation, preserves the public `DocumentAnalysis` API, and narrows downstream invalidation.

**Architecture:** Introduce a generic incremental engine behind `documentAnalysisField` that builds a `SemanticDelta`, expands dirty windows, runs one shared extraction pass per dirty window, merges per-slice structural objects, and finalizes propagated numbering in deterministic phases. Keep narrative references as a global fallback in v1, and only migrate hot consumers after the semantic field is correct and identity-stable.

**Tech Stack:** TypeScript, CodeMirror 6 StateField/Transaction APIs, Lezer syntax trees, Vitest, existing perf-regression tooling.

---

### Task 1: Freeze the Current Contract With Analysis-Level Tests

**Files:**
- Create: `src/semantics/codemirror-source.incremental.test.ts`
- Modify: `src/semantics/codemirror-source.ts`
- Test: `src/semantics/codemirror-source.incremental.test.ts`

**Step 1: Write the failing tests**

Add tests that describe the target contract, not the current implementation:

- unchanged math region object identity survives unrelated edits
- heading insertion near top changes later heading numbers but preserves unaffected prefix structure
- fenced-div body edit does not recreate unrelated fenced div objects
- narrative references are still correct after edits near link/code/math exclusion zones

Use `EditorState.create({ extensions: [...] })`, dispatch real transactions, and compare object identity with `toBe`.

**Step 2: Run the test file to verify failure**

Run: `npx vitest run src/semantics/codemirror-source.incremental.test.ts`

Expected: FAIL because the current field recreates a fresh whole-document analysis on each edit.

**Step 3: Add a temporary internal test helper export**

Expose a small helper from `src/semantics/codemirror-source.ts` if needed so tests can inspect internal revisions later without changing the public field API.

**Step 4: Run the tests again**

Run: `npx vitest run src/semantics/codemirror-source.incremental.test.ts`

Expected: FAIL on identity assertions, PASS on plain semantic equality assertions if written as characterization.

**Step 5: Commit**

```bash
git add src/semantics/codemirror-source.incremental.test.ts src/semantics/codemirror-source.ts
git commit -m "test: add incremental semantics contract coverage"
```

### Task 2: Introduce Internal Incremental Types

**Files:**
- Create: `src/semantics/incremental/types.ts`
- Modify: `src/semantics/document.ts`
- Modify: `src/semantics/codemirror-source.ts`
- Test: `src/semantics/codemirror-source.incremental.test.ts`

**Step 1: Write the failing type-level and smoke tests**

Add a smoke assertion that the internal analysis snapshot can carry:

- `revision`
- `sliceRevisions`
- internal metadata not exposed to ordinary consumers

**Step 2: Run the targeted test**

Run: `npx vitest run src/semantics/codemirror-source.incremental.test.ts`

Expected: FAIL because the internal enriched type does not exist.

**Step 3: Add the minimal internal types**

Define:

```ts
export interface SemanticDelta { /* plain transaction-derived envelope */ }
export interface DirtyWindow { /* old/new coordinate window */ }
export interface SliceRevisionSet { /* per-slice revision numbers */ }
export interface IncrementalDocumentAnalysis extends DocumentAnalysis { /* internal superset */ }
```

Keep them internal to `src/semantics/incremental/types.ts` and imported only where needed.

**Step 4: Re-run the targeted test**

Run: `npx vitest run src/semantics/codemirror-source.incremental.test.ts`

Expected: PASS for type/smoke assertions, FAIL for unimplemented behavior.

**Step 5: Commit**

```bash
git add src/semantics/incremental/types.ts src/semantics/document.ts src/semantics/codemirror-source.ts src/semantics/codemirror-source.incremental.test.ts
git commit -m "refactor: add incremental semantics internal types"
```

### Task 3: Implement `SemanticDelta`

**Files:**
- Create: `src/semantics/incremental/semantic-delta.ts`
- Create: `src/semantics/incremental/semantic-delta.test.ts`
- Modify: `src/semantics/codemirror-source.ts`
- Test: `src/semantics/incremental/semantic-delta.test.ts`

**Step 1: Write the failing tests**

Cover:

- single insert
- single delete
- multiple changed ranges
- syntax-tree-only invalidation
- frontmatter/global invalidator flags

Test exact old/new ranges and mapped positions.

**Step 2: Run the test file**

Run: `npx vitest run src/semantics/incremental/semantic-delta.test.ts`

Expected: FAIL because the module does not exist.

**Step 3: Write the minimal implementation**

Build `SemanticDelta` directly from `Transaction`:

```ts
export function buildSemanticDelta(tr: Transaction): SemanticDelta {
  const windows: RawChangedRange[] = [];
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    windows.push({ fromA, toA, fromB, toB });
  });
  return { /* coarsely filled shape for now */ };
}
```

Do not add any retained cache. Only compute what the next stages need.

**Step 4: Re-run the test**

Run: `npx vitest run src/semantics/incremental/semantic-delta.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/semantics/incremental/semantic-delta.ts src/semantics/incremental/semantic-delta.test.ts src/semantics/codemirror-source.ts
git commit -m "feat: build semantic delta from transactions"
```

### Task 4: Implement Dirty-Window Coalescing

**Files:**
- Create: `src/semantics/incremental/dirty-windows.ts`
- Create: `src/semantics/incremental/dirty-windows.test.ts`
- Modify: `src/semantics/incremental/semantic-delta.ts`
- Test: `src/semantics/incremental/dirty-windows.test.ts`

**Step 1: Write the failing tests**

Cover:

- adjacent edits coalesce into one window
- distant edits stay separate
- old/new coordinate pairs remain aligned
- empty inserts still produce usable windows

**Step 2: Run the test file**

Run: `npx vitest run src/semantics/incremental/dirty-windows.test.ts`

Expected: FAIL because the module does not exist.

**Step 3: Write the minimal implementation**

Add:

```ts
export function coalesceChangedRanges(
  ranges: readonly RawChangedRange[],
  gap: number = 32,
): DirtyWindow[] {
  // sort, merge nearby edits, preserve both coordinate spaces
}
```

Use a small conservative default gap that can be tuned later.

**Step 4: Re-run the test**

Run: `npx vitest run src/semantics/incremental/dirty-windows.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/semantics/incremental/dirty-windows.ts src/semantics/incremental/dirty-windows.test.ts src/semantics/incremental/semantic-delta.ts
git commit -m "feat: add dirty-window coalescing"
```

### Task 5: Extract Shared Window Walk Output

**Files:**
- Create: `src/semantics/incremental/window-extractor.ts`
- Create: `src/semantics/incremental/window-extractor.test.ts`
- Modify: `src/semantics/document.ts`
- Test: `src/semantics/incremental/window-extractor.test.ts`

**Step 1: Write the failing tests**

Create tests that compare:

- full-document `unifiedTreeWalk` output
- one-window extractor output over the same full range

They should match for:

- headings
- fenced divs
- math regions
- equations
- footnote refs/defs
- bracketed refs

**Step 2: Run the test file**

Run: `npx vitest run src/semantics/incremental/window-extractor.test.ts`

Expected: FAIL because the shared extractor does not exist.

**Step 3: Refactor `unifiedTreeWalk` into reusable pieces**

Do not duplicate parsing logic. Pull the node-dispatch logic into a helper that can accept:

- `doc`
- `tree`
- an optional `[from, to]` window
- a result accumulator

Keep one tree walk per window.

**Step 4: Re-run the test**

Run: `npx vitest run src/semantics/incremental/window-extractor.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/semantics/incremental/window-extractor.ts src/semantics/incremental/window-extractor.test.ts src/semantics/document.ts
git commit -m "refactor: expose shared semantic window extractor"
```

### Task 6: Add Generic Local-Merge Utilities

**Files:**
- Create: `src/semantics/incremental/merge-utils.ts`
- Create: `src/semantics/incremental/merge-utils.test.ts`
- Test: `src/semantics/incremental/merge-utils.test.ts`

**Step 1: Write the failing tests**

Cover:

- mapping old objects through `tr.changes`
- dropping objects overlapping a dirty window
- splicing fresh objects into the correct sorted position
- reusing untouched object identity

Use simple fake objects with `from` and `to`.

**Step 2: Run the test file**

Run: `npx vitest run src/semantics/incremental/merge-utils.test.ts`

Expected: FAIL because utilities do not exist.

**Step 3: Write the minimal implementation**

Add utilities like:

```ts
export function mapRangeObject<T extends { from: number; to: number }>(...)
export function replaceOverlappingRanges<T extends { from: number; to: number }>(...)
export function firstOverlapIndex<T extends { from: number; to: number }>(...)
```

Keep them generic and tiny. No class hierarchy.

**Step 4: Re-run the test**

Run: `npx vitest run src/semantics/incremental/merge-utils.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/semantics/incremental/merge-utils.ts src/semantics/incremental/merge-utils.test.ts
git commit -m "feat: add incremental merge utilities"
```

### Task 7: Implement Local Slice Merge for Math, Fenced Divs, and Includes

**Files:**
- Create: `src/semantics/incremental/slices/math-slice.ts`
- Create: `src/semantics/incremental/slices/fenced-div-slice.ts`
- Create: `src/semantics/incremental/slices/include-slice.ts`
- Create: `src/semantics/incremental/slices/local-slices.test.ts`
- Modify: `src/semantics/document.ts`
- Test: `src/semantics/incremental/slices/local-slices.test.ts`

**Step 1: Write the failing tests**

Cover:

- edit inside one math block only replaces that `MathSemantics`
- edit in one theorem body keeps unrelated `FencedDivSemantics` identity
- edit in one include block only changes the derived `IncludeSemantics` for that block

**Step 2: Run the test file**

Run: `npx vitest run src/semantics/incremental/slices/local-slices.test.ts`

Expected: FAIL because the slice modules do not exist.

**Step 3: Write the minimal implementations**

Each slice should:

- map existing objects
- accept shared window extraction output
- replace overlaps inside dirty windows
- derive lookup maps from final arrays

Keep includes derived from fenced divs, not independently parsed.

**Step 4: Re-run the test**

Run: `npx vitest run src/semantics/incremental/slices/local-slices.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/semantics/incremental/slices/math-slice.ts src/semantics/incremental/slices/fenced-div-slice.ts src/semantics/incremental/slices/include-slice.ts src/semantics/incremental/slices/local-slices.test.ts src/semantics/document.ts
git commit -m "feat: merge local semantic slices incrementally"
```

### Task 8: Implement Heading Structural Merge and Tail Numbering

**Files:**
- Create: `src/semantics/incremental/slices/heading-slice.ts`
- Create: `src/semantics/incremental/slices/heading-slice.test.ts`
- Modify: `src/semantics/document.ts`
- Test: `src/semantics/incremental/slices/heading-slice.test.ts`

**Step 1: Write the failing tests**

Cover:

- unrelated paragraph edit maps headings unchanged
- heading text edit replaces one heading object only
- heading insertion near top recomputes numbering tail, not the entire prefix
- unnumbered heading behavior stays correct

**Step 2: Run the test file**

Run: `npx vitest run src/semantics/incremental/slices/heading-slice.test.ts`

Expected: FAIL because the slice does not exist.

**Step 3: Write the minimal implementation**

Split heading handling into:

- structural heading objects
- a finalization pass that recomputes `number` from the earliest affected heading onward

Do not mutate reused prefix objects.

**Step 4: Re-run the test**

Run: `npx vitest run src/semantics/incremental/slices/heading-slice.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/semantics/incremental/slices/heading-slice.ts src/semantics/incremental/slices/heading-slice.test.ts src/semantics/document.ts
git commit -m "feat: incrementally merge headings with tail numbering"
```

### Task 9: Implement Equation Structural Merge and Tail Numbering

**Files:**
- Create: `src/semantics/incremental/slices/equation-slice.ts`
- Create: `src/semantics/incremental/slices/equation-slice.test.ts`
- Modify: `src/semantics/document.ts`
- Test: `src/semantics/incremental/slices/equation-slice.test.ts`

**Step 1: Write the failing tests**

Cover:

- unlabeled display-math edits do not disturb labeled equation numbering
- labeled equation text edit updates one equation
- inserting a labeled equation before existing ones renumbers only the tail
- `equationById` remains correct

**Step 2: Run the test file**

Run: `npx vitest run src/semantics/incremental/slices/equation-slice.test.ts`

Expected: FAIL because the slice does not exist.

**Step 3: Write the minimal implementation**

Split equation handling into:

- structural equation entries with stable `id`
- final numbering pass from the earliest affected labeled equation

Rebuild `equationById` from the final array.

**Step 4: Re-run the test**

Run: `npx vitest run src/semantics/incremental/slices/equation-slice.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/semantics/incremental/slices/equation-slice.ts src/semantics/incremental/slices/equation-slice.test.ts src/semantics/document.ts
git commit -m "feat: incrementally merge equations with tail numbering"
```

### Task 10: Implement Footnote Structural Merge and Numbering Tail

**Files:**
- Create: `src/semantics/incremental/slices/footnote-slice.ts`
- Create: `src/semantics/incremental/slices/footnote-slice.test.ts`
- Modify: `src/semantics/document.ts`
- Test: `src/semantics/incremental/slices/footnote-slice.test.ts`

**Step 1: Write the failing tests**

Cover:

- editing one footnote definition preserves unrelated def identities
- editing one footnote ref preserves unrelated ref identities
- moving the first reference to a new position renumbers later displayed footnotes

**Step 2: Run the test file**

Run: `npx vitest run src/semantics/incremental/slices/footnote-slice.test.ts`

Expected: FAIL because the slice does not exist.

**Step 3: Write the minimal implementation**

Represent structural footnotes as:

- ordered refs array
- defs map and `defByFrom`

Then run displayed numbering derivation from the earliest affected reference index forward.

**Step 4: Re-run the test**

Run: `npx vitest run src/semantics/incremental/slices/footnote-slice.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/semantics/incremental/slices/footnote-slice.ts src/semantics/incremental/slices/footnote-slice.test.ts src/semantics/document.ts
git commit -m "feat: incrementally merge footnotes with tail numbering"
```

### Task 11: Split References Into Bracketed Incremental and Narrative Global Fallback

**Files:**
- Create: `src/semantics/incremental/slices/reference-slice.ts`
- Create: `src/semantics/incremental/slices/reference-slice.test.ts`
- Modify: `src/semantics/document.ts`
- Test: `src/semantics/incremental/slices/reference-slice.test.ts`

**Step 1: Write the failing tests**

Cover:

- bracketed `[@id]` edits update locally
- narrative `@id` stays correct after edits near links, code, and math
- combined reference list remains sorted

**Step 2: Run the test file**

Run: `npx vitest run src/semantics/incremental/slices/reference-slice.test.ts`

Expected: FAIL because the slice does not exist.

**Step 3: Write the minimal implementation**

Implement:

- incremental merge for bracketed refs from shared window extraction
- explicit global fallback for narrative refs using the existing [collectNarrativeReferences](/Users/chaoxu/playground/coflat/src/semantics/document.ts#L548)

Document the fallback clearly in code comments.

**Step 4: Re-run the test**

Run: `npx vitest run src/semantics/incremental/slices/reference-slice.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/semantics/incremental/slices/reference-slice.ts src/semantics/incremental/slices/reference-slice.test.ts src/semantics/document.ts
git commit -m "feat: split reference handling into incremental and fallback paths"
```

### Task 12: Wire the Incremental Engine Into `documentAnalysisField`

**Files:**
- Create: `src/semantics/incremental/engine.ts`
- Create: `src/semantics/incremental/engine.test.ts`
- Modify: `src/semantics/codemirror-source.ts`
- Modify: `src/semantics/document.ts`
- Test: `src/semantics/incremental/engine.test.ts`

**Step 1: Write the failing tests**

Cover:

- no-op transactions reuse the prior analysis object
- local edit bumps only expected slice revisions
- top-level revision increments exactly once per semantic update
- public arrays/maps remain available through `documentAnalysisField`

**Step 2: Run the test file**

Run: `npx vitest run src/semantics/incremental/engine.test.ts`

Expected: FAIL because the engine does not exist.

**Step 3: Write the minimal implementation**

`engine.ts` should:

- build `SemanticDelta`
- expand windows
- call the shared extractor
- run slices in fixed phase order
- assemble the final public analysis projection

Then switch [documentAnalysisField](/Users/chaoxu/playground/coflat/src/semantics/codemirror-source.ts#L34) to use it.

**Step 4: Re-run the test**

Run: `npx vitest run src/semantics/incremental/engine.test.ts src/semantics/codemirror-source.incremental.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/semantics/incremental/engine.ts src/semantics/incremental/engine.test.ts src/semantics/codemirror-source.ts src/semantics/document.ts src/semantics/codemirror-source.incremental.test.ts
git commit -m "feat: wire incremental engine into document analysis field"
```

### Task 13: Narrow `pluginRegistryField` Invalidation

**Files:**
- Modify: `src/plugins/plugin-registry.ts`
- Create: `src/plugins/plugin-registry.test.ts`
- Modify: `src/editor/frontmatter-state.ts`
- Test: `src/plugins/plugin-registry.test.ts`

**Step 1: Write the failing tests**

Cover:

- plain body-text edit does not rebuild plugin registry
- frontmatter block-config edit does rebuild plugin registry
- editors without frontmatter still behave correctly

**Step 2: Run the test file**

Run: `npx vitest run src/plugins/plugin-registry.test.ts`

Expected: FAIL because registry still keys off `docChanged`.

**Step 3: Write the minimal implementation**

Switch registry invalidation to:

- frontmatter block-config identity or revision
- built-in plugin facet changes

Do not leave raw `docChanged` as the gate.

**Step 4: Re-run the test**

Run: `npx vitest run src/plugins/plugin-registry.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/plugins/plugin-registry.ts src/plugins/plugin-registry.test.ts src/editor/frontmatter-state.ts
git commit -m "perf: narrow plugin registry invalidation"
```

### Task 14: Migrate Math and Reference Renderers to Slice-Aware Invalidation

**Files:**
- Modify: `src/render/math-render.ts`
- Modify: `src/render/reference-render.ts`
- Modify: `src/render/math-render.test.ts`
- Modify: `src/render/reference-render.test.ts`
- Test: `src/render/math-render.test.ts`
- Test: `src/render/reference-render.test.ts`

**Step 1: Write the failing tests**

Add assertions that:

- unrelated edits do not trigger rebuild because only whole-analysis identity changed
- math renderer keys off `mathRegions` slice revision or identity
- reference renderer keys off `references` and crossref-dependent revisions

**Step 2: Run the targeted tests**

Run: `npx vitest run src/render/math-render.test.ts src/render/reference-render.test.ts`

Expected: FAIL because renderers still use coarse top-level signals.

**Step 3: Write the minimal implementation**

Update predicates so they depend on:

- relevant slice revision or slice object identity
- cursor/focus transition logic
- true global invalidators such as math macros or CSL data effects

Keep current behavior unchanged from the user’s perspective.

**Step 4: Re-run the targeted tests**

Run: `npx vitest run src/render/math-render.test.ts src/render/reference-render.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/render/math-render.ts src/render/reference-render.ts src/render/math-render.test.ts src/render/reference-render.test.ts
git commit -m "perf: narrow math and reference invalidation to semantic slices"
```

### Task 15: Migrate Include Labels, Sidenotes, and Block Counters

**Files:**
- Modify: `src/render/include-label.ts`
- Modify: `src/render/sidenote-render.ts`
- Modify: `src/plugins/block-counter.ts`
- Modify: `src/render/section-counter.ts`
- Modify: corresponding test files
- Test: `src/render/section-counter.test.ts`
- Test: `src/render/sidenote-render.test.ts`
- Test: `src/plugins/block-counter.test.ts`

**Step 1: Write the failing tests**

Cover:

- include labels only update when include slice changes or selection changes
- sidenotes only rebuild when footnote slice or local toggle state changes
- block counters recompute from fenced-div or registry changes, not whole-analysis identity
- section counters continue to behave with the new incremental heading data

**Step 2: Run the targeted tests**

Run: `npx vitest run src/render/section-counter.test.ts src/render/sidenote-render.test.ts src/plugins/block-counter.test.ts`

Expected: FAIL where predicates remain too broad.

**Step 3: Write the minimal implementation**

Use slice revisions/identities rather than whole-analysis identity wherever possible. Preserve existing local `mapOnDocChanged` wins.

**Step 4: Re-run the targeted tests**

Run: `npx vitest run src/render/section-counter.test.ts src/render/sidenote-render.test.ts src/plugins/block-counter.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/render/include-label.ts src/render/sidenote-render.ts src/plugins/block-counter.ts src/render/section-counter.ts src/render/section-counter.test.ts src/render/sidenote-render.test.ts src/plugins/block-counter.test.ts
git commit -m "perf: migrate dependent renderers to incremental slice invalidation"
```

### Task 16: Run Full Semantic and Renderer Regression Coverage

**Files:**
- Modify: tests only if failures expose real missing coverage
- Test: `src/semantics/**/*.test.ts`
- Test: `src/render/**/*.test.ts`
- Test: `src/plugins/**/*.test.ts`
- Test: `src/citations/**/*.test.ts`

**Step 1: Run the semantic test subset**

Run: `npx vitest run src/semantics/**/*.test.ts`

Expected: PASS.

**Step 2: Run the renderer and plugin subset**

Run: `npx vitest run src/render/**/*.test.ts src/plugins/**/*.test.ts src/citations/**/*.test.ts`

Expected: PASS.

**Step 3: Fix any real regressions**

If something fails:

- add the smallest missing test first
- fix the underlying logic
- rerun the narrow failing subset before rerunning the broader subset

**Step 4: Re-run the full targeted regression set**

Run: `npx vitest run src/semantics/**/*.test.ts src/render/**/*.test.ts src/plugins/**/*.test.ts src/citations/**/*.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src
git commit -m "test: verify incremental semantics across consumers"
```

### Task 17: Typecheck and Browser Verification

**Files:**
- No planned source changes unless verification exposes a bug
- Test: browser dev session against `index.md`

**Step 1: Run typecheck**

Run: `npx tsc --noEmit`

Expected: PASS.

**Step 2: Run browser verification on `index.md`**

Run the normal repo workflow:

```bash
npm run dev
npm run chrome
```

Then verify:

- math still renders
- block headers still behave like headings
- section numbers still appear
- citations/crossrefs still resolve
- footnotes still render and toggle
- theorem/edit-locality scenarios do not visibly churn

Use `__cmDebug.dump()` and app helpers as needed.

**Step 3: Run perf comparison**

Use the existing perf workflow in [docs/perf-regression.md](/Users/chaoxu/playground/coflat/docs/perf-regression.md).

Expected:

- no regression on baseline checks
- measurable reduction in semantic churn on local edits

**Step 4: Fix any verification regressions**

Prefer fixing root causes over widening invalidation again.

**Step 5: Commit**

```bash
git add src docs/plans
git commit -m "perf: land incremental semantics engine"
```

### Task 18: Final Review Gate

**Files:**
- No direct file target

**Step 1: Run reviewer gate**

Launch the required code reviewer and simplifier checks on the final diff before merge or final commit.

**Step 2: Apply findings**

Only keep changes that improve correctness, simplicity, or maintainability.

**Step 3: Re-run the narrow affected tests**

Run the specific tests impacted by any reviewer-driven edits.

**Step 4: Re-run typecheck**

Run: `npx tsc --noEmit`

Expected: PASS.

**Step 5: Final commit if needed**

```bash
git add src docs/plans
git commit -m "chore: finalize incremental semantics rollout"
```

## Execution Notes

- Keep the public `DocumentAnalysis` surface stable until the incremental engine is correct.
- Do not make narrative refs incremental in the first pass.
- Do not add persistent caches or interning tables.
- Prefer one shared extraction walk per dirty window.
- Prefer tail recompute to whole-document recompute whenever ordering semantics require propagation.
- Treat `pluginRegistryField` narrowing as part of the same architecture fix, not optional cleanup.
