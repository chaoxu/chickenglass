/**
 * Transaction filters and atomic ranges that protect fenced block fence syntax
 * (fenced divs, fenced code blocks, and display math) from accidental edits
 * in rich mode.
 *
 * Extracted from plugin-render.ts so that fence protection is a standalone
 * module with clear boundaries. The blockRenderPlugin wires this extension
 * into the editor; block-type-picker uses the bypass annotation.
 *
 * Unified in #441 to cover both `::: {.class} ... :::` fenced divs and
 * ``` ``` ... ``` ``` fenced code blocks with a single protection stack.
 * Extended in #777 to cover `$$ ... $$` and `\[ ... \]` display math.
 *
 * Provides:
 * - `fenceOperationAnnotation` — bypass annotation for programmatic edits
 * - `getProtectedDivs` — collect fenced divs eligible for protection
 * - `getClosingFenceRanges` — closing fence line ranges (divs + code blocks + math)
 * - `getOpeningFenceColonRanges` — opening fence colon-prefix ranges (divs only)
 * - `getOpeningFenceBacktickRanges` — opening fence backtick-prefix ranges (code blocks only)
 * - `getOpeningMathDelimiterRanges` — opening math delimiter ranges (display math only)
 * - `fenceProtectionExtension` — unified CM6 extension with one transaction pipeline
 * - compatibility filter exports used by focused tests and narrow consumers
 * - `pairedMathEntry` — auto-insert closing delimiter when typing $$ or \[
 * - `closingFenceAtomicRanges` — cursor skips over hidden closing fences
 */

import {
  Annotation,
  EditorState,
  type Extension,
  type Transaction,
  RangeSet,
  StateField,
} from "@codemirror/state";
import { type Decoration, EditorView } from "@codemirror/view";
import {
  collectDisplayMathBlocks,
  docChangeTouchesFencedDivStructure,
  collectFencedDivs,
  mapDisplayMathBlockInfo,
  mapFencedBlockInfo,
  mapFencedDivInfo,
  type DisplayMathBlockInfo,
  type FencedBlockInfo,
  type FencedDivInfo,
} from "../fenced-block/model";
import {
  type FenceChangeSpec,
  type FenceRange,
} from "./fence-protection-pipeline";
import { pluginRegistryField } from "../state/plugin-registry";
import {
  buildClosingFenceAtomicRanges,
  buildClosingFenceRanges,
  buildOpeningFenceBacktickRanges,
  buildOpeningFenceColonRanges,
  buildOpeningMathDelimiterRanges,
} from "./fence-builders";
import {
  createClosingFenceProtection,
  createEmptyMathBlockBackspaceCleanup,
  createFenceProtectionTransactionFilter,
  createOpeningFenceBacktickProtection,
  createOpeningFenceColonProtection,
  createOpeningFenceDeletionCleanup,
  createOpeningFenceMathProtection,
} from "./fence-transaction-filters";
import { createPairedMathEntry } from "./fence-math-entry";
import {
  type PluginRegistryState,
  getPluginOrFallback,
} from "./plugin-registry";
import { createChangeChecker } from "../state/change-detection";
import {
  documentSemanticsField,
  getDocumentAnalysisSliceRevision,
} from "../state/document-analysis";
import {
  codeBlockStructureField,
  collectCodeBlocks,
  getCodeBlockStructureRevision,
  type CodeBlockInfo,
} from "../state/code-block-structure";
import { EXCLUDED_FROM_FALLBACK } from "../constants/block-manifest";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";

interface FenceProtectionCache {
  readonly allFencedBlocks: readonly FencedBlockInfo[];
  readonly protectedDivs: readonly FencedDivInfo[];
  readonly closingFenceRanges: readonly FenceRange[];
  readonly openingFenceColonRanges: readonly FenceRange[];
  readonly openingFenceBacktickRanges: readonly FenceRange[];
  readonly openingMathDelimiterRanges: readonly FenceRange[];
  readonly closingFenceAtomicRanges: RangeSet<Decoration>;
  readonly sourceState: FenceProtectionCacheSourceState;
}

interface FenceProtectionCacheSourceState {
  readonly registry: PluginRegistryState | null;
  readonly fencedDivsRevision: number | null;
  readonly codeBlockStructureRevision: number | null;
}

interface FenceProtectionInputs {
  readonly allFencedBlocks: readonly FencedBlockInfo[];
  readonly protectedDivs: readonly FencedDivInfo[];
  readonly codeBlocks: readonly CodeBlockInfo[];
  readonly displayMathBlocks: readonly DisplayMathBlockInfo[];
}

function currentFenceProtectionSourceState(
  state: EditorState,
): FenceProtectionCacheSourceState {
  const semantics = state.field(documentSemanticsField, false);
  const codeBlockStructure = state.field(codeBlockStructureField, false);
  return {
    registry: state.field(pluginRegistryField, false) ?? null,
    fencedDivsRevision: semantics
      ? getDocumentAnalysisSliceRevision(semantics, "fencedDivs")
      : null,
    codeBlockStructureRevision: codeBlockStructure
      ? getCodeBlockStructureRevision(state)
      : null,
  };
}

function filterProtectedDivs(
  state: EditorState,
  divs: readonly FencedDivInfo[],
): FencedDivInfo[] {
  const registry = state.field(pluginRegistryField, false);
  return divs.filter((div) => {
    if (div.singleLine) return false;
    if (EXCLUDED_FROM_FALLBACK.has(div.className)) return false;
    if (registry && !getPluginOrFallback(registry, div.className)) return false;
    return true;
  });
}

function collectFenceProtectionInputs(state: EditorState): FenceProtectionInputs {
  const fencedDivs = collectFencedDivs(state);
  const protectedDivs = filterProtectedDivs(state, fencedDivs);
  const codeBlocks = collectCodeBlocks(state);
  const displayMathBlocks = collectDisplayMathBlocks(state);
  return {
    allFencedBlocks: [...fencedDivs, ...codeBlocks, ...displayMathBlocks],
    protectedDivs,
    codeBlocks,
    displayMathBlocks,
  };
}

function buildFenceProtectionCache(
  state: EditorState,
  inputs = collectFenceProtectionInputs(state),
): FenceProtectionCache {
  const closingFenceRanges = buildClosingFenceRanges(
    state,
    inputs.protectedDivs,
    inputs.codeBlocks,
    inputs.displayMathBlocks,
  );

  return {
    allFencedBlocks: inputs.allFencedBlocks,
    protectedDivs: inputs.protectedDivs,
    closingFenceRanges,
    openingFenceColonRanges: buildOpeningFenceColonRanges(state, inputs.protectedDivs),
    openingFenceBacktickRanges: buildOpeningFenceBacktickRanges(inputs.codeBlocks),
    openingMathDelimiterRanges: buildOpeningMathDelimiterRanges(inputs.displayMathBlocks),
    closingFenceAtomicRanges: buildClosingFenceAtomicRanges(state, closingFenceRanges),
    sourceState: currentFenceProtectionSourceState(state),
  };
}

function didSemanticsSliceChange(
  startState: EditorState,
  nextState: EditorState,
  slice: "fencedDivs",
): boolean {
  const startSemantics = startState.field(documentSemanticsField, false);
  const nextSemantics = nextState.field(documentSemanticsField, false);
  if (!startSemantics || !nextSemantics) return startSemantics !== nextSemantics;
  return getDocumentAnalysisSliceRevision(startSemantics, slice)
    !== getDocumentAnalysisSliceRevision(nextSemantics, slice);
}

function sameDisplayMathBlock(
  left: DisplayMathBlockInfo,
  right: DisplayMathBlockInfo,
): boolean {
  return left.from === right.from
    && left.to === right.to
    && left.openFenceFrom === right.openFenceFrom
    && left.openFenceTo === right.openFenceTo
    && left.closeFenceFrom === right.closeFenceFrom
    && left.closeFenceTo === right.closeFenceTo
    && left.openDelimiterFrom === right.openDelimiterFrom
    && left.openingDelimiter === right.openingDelimiter
    && left.closingDelimiter === right.closingDelimiter
    && left.closeLineTo === right.closeLineTo;
}

function sameDisplayMathBlocks(
  left: readonly DisplayMathBlockInfo[],
  right: readonly DisplayMathBlockInfo[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!sameDisplayMathBlock(left[index], right[index])) return false;
  }
  return true;
}

function mapFencedBlocks(
  blocks: readonly FencedBlockInfo[],
  tr: Transaction,
): readonly FencedBlockInfo[] {
  let changed = false;
  const mapped = blocks.map((block) => {
    const next = mapFencedBlockInfo(block, tr.changes);
    if (next !== block) changed = true;
    return next;
  });
  return changed ? mapped : blocks;
}

function mapProtectedDivs(
  divs: readonly FencedDivInfo[],
  tr: Transaction,
): readonly FencedDivInfo[] {
  let changed = false;
  const mapped = divs.map((div) => {
    const next = mapFencedDivInfo(div, tr.changes);
    if (next !== div) changed = true;
    return next;
  });
  return changed ? mapped : divs;
}

function mapFenceRange(
  range: FenceRange,
  tr: Transaction,
): FenceRange {
  const from = tr.changes.mapPos(range.from, 1);
  const to = Math.max(from, tr.changes.mapPos(range.to, -1));
  if (from === range.from && to === range.to) return range;
  return { from, to };
}

function mapFenceRanges(
  ranges: readonly FenceRange[],
  tr: Transaction,
): readonly FenceRange[] {
  let changed = false;
  const mapped = ranges.map((range) => {
    const next = mapFenceRange(range, tr);
    if (next !== range) changed = true;
    return next;
  });
  return changed ? mapped : ranges;
}

function mapDisplayMathBlocks(
  blocks: readonly DisplayMathBlockInfo[],
  tr: Transaction,
): readonly DisplayMathBlockInfo[] {
  let changed = false;
  const mapped = blocks.map((block) => {
    const next = mapDisplayMathBlockInfo(block, tr.changes);
    if (next !== block) changed = true;
    return next;
  });
  return changed ? mapped : blocks;
}

function didCodeBlockFenceStructureChange(tr: Transaction): boolean {
  const startStructure = tr.startState.field(codeBlockStructureField, false);
  const nextStructure = tr.state.field(codeBlockStructureField, false);
  if (!startStructure || !nextStructure) {
    const before = collectCodeBlocks(tr.startState);
    if (before.length === 0 && collectCodeBlocks(tr.state).length === 0) return false;
    return tr.docChanged;
  }
  return getCodeBlockStructureRevision(tr.startState) !== getCodeBlockStructureRevision(tr.state);
}

function docChangeCouldAffectDisplayMathFences(tr: Transaction): boolean {
  let affects = false;

  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (affects) return;
    const oldLineFrom = tr.startState.doc.lineAt(fromA).from;
    const oldLineTo = tr.startState.doc.lineAt(Math.max(fromA, toA)).to;
    const newLineFrom = tr.state.doc.lineAt(fromB).from;
    const newLineTo = tr.state.doc.lineAt(Math.max(fromB, toB)).to;
    const oldText = tr.startState.sliceDoc(oldLineFrom, oldLineTo);
    const newText = tr.state.sliceDoc(newLineFrom, newLineTo);
    affects = oldText.includes("$")
      || oldText.includes("\\")
      || newText.includes("$")
      || newText.includes("\\");
  });

  return affects;
}

function didDisplayMathFenceGeometryChange(tr: Transaction): boolean {
  if (tr.docChanged && !docChangeCouldAffectDisplayMathFences(tr)) {
    return false;
  }
  const before = collectDisplayMathBlocks(tr.startState);
  const after = collectDisplayMathBlocks(tr.state);
  if (!tr.docChanged) return !sameDisplayMathBlocks(before, after);
  return !sameDisplayMathBlocks(mapDisplayMathBlocks(before, tr), after);
}

const fenceProtectionRegistryChanged = createChangeChecker(
  (state) => state.field(pluginRegistryField, false),
);

function shouldRebuildFenceProtectionCache(tr: Transaction): boolean {
  if (fenceProtectionRegistryChanged(tr)) {
    return true;
  }
  if (
    didSemanticsSliceChange(tr.startState, tr.state, "fencedDivs")
    && (!tr.docChanged || docChangeTouchesFencedDivStructure(tr))
  ) {
    return true;
  }
  if (didCodeBlockFenceStructureChange(tr)) return true;
  if (didDisplayMathFenceGeometryChange(tr)) return true;
  return false;
}

function mapFenceProtectionCache(
  value: FenceProtectionCache,
  tr: Transaction,
): FenceProtectionCache {
  const allFencedBlocks = mapFencedBlocks(value.allFencedBlocks, tr);
  const protectedDivs = mapProtectedDivs(value.protectedDivs, tr);
  const closingFenceRanges = mapFenceRanges(value.closingFenceRanges, tr);
  const openingFenceColonRanges = mapFenceRanges(value.openingFenceColonRanges, tr);
  const openingFenceBacktickRanges = mapFenceRanges(value.openingFenceBacktickRanges, tr);
  const openingMathDelimiterRanges = mapFenceRanges(value.openingMathDelimiterRanges, tr);
  const closingFenceAtomicRanges = closingFenceRanges === value.closingFenceRanges
    ? value.closingFenceAtomicRanges
    : value.closingFenceAtomicRanges.map(tr.changes);

  if (
    allFencedBlocks === value.allFencedBlocks
    && protectedDivs === value.protectedDivs
    && closingFenceRanges === value.closingFenceRanges
    && openingFenceColonRanges === value.openingFenceColonRanges
    && openingFenceBacktickRanges === value.openingFenceBacktickRanges
    && openingMathDelimiterRanges === value.openingMathDelimiterRanges
    && closingFenceAtomicRanges === value.closingFenceAtomicRanges
  ) {
    return value;
  }

  return {
    allFencedBlocks,
    protectedDivs,
    closingFenceRanges,
    openingFenceColonRanges,
    openingFenceBacktickRanges,
    openingMathDelimiterRanges,
    closingFenceAtomicRanges,
    sourceState: currentFenceProtectionSourceState(tr.state),
  };
}

const fenceProtectionCacheField = StateField.define<FenceProtectionCache>({
  create(state) {
    return buildFenceProtectionCache(state);
  },

  update(value, tr) {
    if (!tr.docChanged) {
      if (!shouldRebuildFenceProtectionCache(tr)) return value;
      return buildFenceProtectionCache(tr.state);
    }

    if (shouldRebuildFenceProtectionCache(tr)) {
      return buildFenceProtectionCache(tr.state);
    }

    return mapFenceProtectionCache(value, tr);
  },
});

function isFenceProtectionCacheCurrent(
  state: EditorState,
  value: FenceProtectionCache,
): boolean {
  const semantics = state.field(documentSemanticsField, false);
  const currentFencedDivsRevision = semantics
    ? getDocumentAnalysisSliceRevision(semantics, "fencedDivs")
    : null;
  if (currentFencedDivsRevision !== value.sourceState.fencedDivsRevision) return false;

  const currentRegistry = state.field(pluginRegistryField, false) ?? null;
  if (currentRegistry !== value.sourceState.registry) return false;

  const codeBlockStructure = state.field(codeBlockStructureField, false);
  const currentCodeBlockStructureRevision = codeBlockStructure
    ? getCodeBlockStructureRevision(state)
    : null;
  return currentCodeBlockStructureRevision === value.sourceState.codeBlockStructureRevision;
}

function getFenceProtectionCache(state: EditorState): FenceProtectionCache {
  const cached = state.field(fenceProtectionCacheField, false);
  if (!cached) return buildFenceProtectionCache(state);
  return isFenceProtectionCacheCurrent(state, cached)
    ? cached
    : buildFenceProtectionCache(state);
}

/**
 * Collect all fenced blocks (fenced divs, code blocks, and display math) for
 * opening-fence deletion cleanup. Uses the shared fence-protection cache
 * (not getProtectedDivs) because cleanup should apply to ALL fenced blocks,
 * including unregistered/custom types.
 */
function collectAllFencedBlocks(state: EditorState): readonly FencedBlockInfo[] {
  return getFenceProtectionCache(state).allFencedBlocks;
}

// ---------------------------------------------------------------------------
// Fence protection
// ---------------------------------------------------------------------------

/** Annotation to bypass fence protection filters (used by block-type picker). */
export const fenceOperationAnnotation = Annotation.define<true>();

function shouldBypassFenceProtection(tr: Transaction): boolean {
  return !tr.docChanged
    || Boolean(tr.annotation(fenceOperationAnnotation))
    || Boolean(tr.annotation(programmaticDocumentChangeAnnotation));
}

function annotateFenceRewrite(
  changes: FenceChangeSpec | readonly FenceChangeSpec[],
) {
  return {
    changes,
    annotations: fenceOperationAnnotation.of(true),
  };
}

/**
 * Return fenced divs that should have their fences protected.
 * Filters out single-line divs, excluded classes (include), and
 * unregistered block types. Shared by all fence range collectors
 * to avoid repeated collectFencedDivs + filtering per transaction.
 */
export function getProtectedDivs(state: EditorState): readonly FencedDivInfo[] {
  return getFenceProtectionCache(state).protectedDivs;
}

/**
 * Collect closing fence line ranges for protection from fenced divs,
 * fenced code blocks, and display math. All multi-line code blocks and
 * display math blocks are protected unconditionally (they have no
 * registry/class filtering like divs).
 */
export function getClosingFenceRanges(state: EditorState): readonly FenceRange[] {
  return getFenceProtectionCache(state).closingFenceRanges;
}

/** Collect opening fence colon-prefix ranges for protection (fenced divs only). */
export function getOpeningFenceColonRanges(state: EditorState): readonly FenceRange[] {
  return getFenceProtectionCache(state).openingFenceColonRanges;
}

/** Collect opening fence backtick-prefix ranges for protection (code blocks only). */
export function getOpeningFenceBacktickRanges(state: EditorState): readonly FenceRange[] {
  return getFenceProtectionCache(state).openingFenceBacktickRanges;
}

/**
 * Transaction filter that auto-removes the closing fence when an opening fence
 * line is fully deleted. Kept as a compatibility export for focused tests;
 * `fenceProtectionExtension` runs the unified pipeline instead of stacking
 * this filter with other independent protections.
 */
export const openingFenceDeletionCleanup = createOpeningFenceDeletionCleanup({
  shouldBypassFenceProtection,
  annotateFenceRewrite,
  getAllFencedBlocks: collectAllFencedBlocks,
});

/**
 * Transaction filter that protects closing fence lines from accidental deletion.
 *
 * Covers both fenced divs and fenced code blocks. Blocks any edit that touches
 * only the closing fence line content. Whole-block deletion (selection covering
 * the entire fenced block) is still allowed so that Cmd+A + Delete works.
 */
export const closingFenceProtection = createClosingFenceProtection({
  shouldBypassFenceProtection,
  getClosingFenceRanges,
});

/**
 * Transaction filter that protects opening fence colon prefixes from accidental edits.
 *
 * In rich mode, users interact with the widget label, not the raw colons.
 * Edits that touch only the colon prefix (:::) are blocked to prevent
 * nesting invariant violations. Edits to attributes ({.theorem}) and
 * title text are unaffected. Whole-block deletion is still allowed.
 *
 * Applies to fenced divs only — code blocks use backtick fences which
 * have no colon prefix.
 */
export const openingFenceColonProtection = createOpeningFenceColonProtection({
  shouldBypassFenceProtection,
  getOpeningFenceColonRanges,
});

/**
 * Transaction filter that protects opening code-fence backtick prefixes.
 *
 * Mirrors openingFenceColonProtection for fenced divs: edits that target only
 * the opening ``` prefix are blocked, while language/info-string edits and
 * whole-block deletion remain allowed.
 */
export const openingFenceBacktickProtection = createOpeningFenceBacktickProtection({
  shouldBypassFenceProtection,
  getOpeningFenceBacktickRanges,
});

/** Collect opening math delimiter ranges for protection (display math only). */
export function getOpeningMathDelimiterRanges(state: EditorState): readonly FenceRange[] {
  return getFenceProtectionCache(state).openingMathDelimiterRanges;
}

/**
 * Transaction filter that protects opening display math delimiter prefixes.
 *
 * Mirrors openingFenceColonProtection for fenced divs: edits that target only
 * the opening $$ or \[ prefix are blocked, while whole-block deletion remains
 * allowed.
 */
export const openingFenceMathProtection = createOpeningFenceMathProtection({
  shouldBypassFenceProtection,
  getOpeningMathDelimiterRanges,
});

/**
 * Atomic ranges for closing fence lines so the cursor skips over them.
 *
 * Covers both fenced divs and fenced code blocks. Uses EditorView.atomicRanges
 * to make hidden closing fences behave as a single atomic unit — the cursor
 * jumps from the last content line to the start of the next block or paragraph
 * without stopping on the fence.
 */
export const closingFenceAtomicRanges = EditorView.atomicRanges.of((view) => {
  return getFenceProtectionCache(view.state).closingFenceAtomicRanges;
});

/**
 * Input handler for paired math entry. When the user completes a display math
 * opening delimiter on a blank line ($$ or \[), auto-insert the closing
 * delimiter and place the cursor between them.
 *
 * Skips auto-insert if the next non-blank line already contains the matching
 * closing delimiter (bracket-match skip).
 */
export const pairedMathEntry = createPairedMathEntry(fenceOperationAnnotation);

/**
 * Transaction filter that removes an empty display math block when a backspace
 * joins the blank content line with the opening delimiter.
 *
 * After pairedMathEntry creates `$$\n\n$$`, pressing Backspace on the empty
 * content line would normally just delete the newline, producing `$$\n$$` with
 * the closing delimiter orphaned. This filter detects that pattern — a single-
 * character newline deletion where the line above is a math opening delimiter
 * and all content below (until the closing delimiter) is blank — and expands
 * the deletion to remove the entire block.
 *
 * Works for both `$$` and `\[`/`\]` delimiter styles.
 */
export const emptyMathBlockBackspaceCleanup = createEmptyMathBlockBackspaceCleanup({
  shouldBypassFenceProtection,
  annotateFenceRewrite,
});

const fenceProtectionTransactionFilter = createFenceProtectionTransactionFilter({
  shouldBypassFenceProtection,
  annotateFenceRewrite,
  getFenceProtectionDecisionInputs(state) {
    const cache = getFenceProtectionCache(state);
    return {
      allFencedBlocks: cache.allFencedBlocks,
      closingFenceRanges: cache.closingFenceRanges,
      openingFenceColonRanges: cache.openingFenceColonRanges,
      openingFenceBacktickRanges: cache.openingFenceBacktickRanges,
      openingMathDelimiterRanges: cache.openingMathDelimiterRanges,
    };
  },
});

/**
 * Combined CM6 extension for all fence protection behavior.
 *
 * Covers fenced divs, fenced code blocks (#441), and display math (#777).
 * The transaction filter now runs one explicit decision pipeline:
 * block illegal edits first, then apply cleanup rewrites, so behavior no
 * longer depends on a stack of separately registered filters.
 */
export const fenceProtectionExtension: Extension = [
  fenceProtectionCacheField,
  fenceProtectionTransactionFilter,
  pairedMathEntry,
  closingFenceAtomicRanges,
];

export type { FenceRange } from "./fence-protection-pipeline";
export { fenceProtectionCacheField as _fenceProtectionCacheFieldForTest };
export { docChangeCouldAffectDisplayMathFences as _docChangeCouldAffectDisplayMathFencesForTest };
