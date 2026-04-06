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
 * - `openingFenceDeletionCleanup` — auto-remove closing fence on opening delete
 * - `closingFenceProtection` — block edits targeting only the closing fence
 * - `openingFenceColonProtection` — block edits targeting opening fence colons
 * - `openingFenceBacktickProtection` — block edits targeting opening fence backticks
 * - `openingFenceMathProtection` — block edits targeting opening math delimiters
 * - `pairedMathEntry` — auto-insert closing delimiter when typing $$ or \[
 * - `emptyMathBlockBackspaceCleanup` — remove entire block when backspacing empty paired math
 * - `closingFenceAtomicRanges` — cursor skips over hidden closing fences
 * - `fenceProtectionExtension` — combined CM6 extension
 */

import {
  type Range,
  Annotation,
  EditorState,
  type Extension,
  type Transaction,
  RangeSet,
  StateField,
} from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import {
  collectDisplayMathBlocks,
  collectFencedDivs,
  mapDisplayMathBlockInfo,
  mapFencedBlockInfo,
  mapFencedDivInfo,
  type DisplayMathBlockInfo,
  type FencedBlockInfo,
  type FencedDivInfo,
} from "../fenced-block/model";
import { pluginRegistryField, getPluginOrFallback } from "./plugin-registry";
import {
  documentSemanticsField,
  getDocumentAnalysisSliceRevision,
} from "../semantics/codemirror-source";
import {
  codeBlockStructureField,
  collectCodeBlocks,
  getCodeBlockStructureRevision,
  type CodeBlockInfo,
} from "../render/code-block-render";
import { countColons } from "../parser";
import { EXCLUDED_FROM_FALLBACK } from "../constants/block-manifest";
import { programmaticDocumentChangeAnnotation } from "../editor/programmatic-document-change";

// ---------------------------------------------------------------------------
// Shared types and helpers
// ---------------------------------------------------------------------------

export interface FenceRange {
  readonly from: number;
  readonly to: number;
}

interface FenceProtectionCache {
  readonly allFencedBlocks: readonly FencedBlockInfo[];
  readonly protectedDivs: readonly FencedDivInfo[];
  readonly closingFenceRanges: readonly FenceRange[];
  readonly openingFenceColonRanges: readonly FenceRange[];
  readonly openingFenceBacktickRanges: readonly FenceRange[];
  readonly openingMathDelimiterRanges: readonly FenceRange[];
  readonly closingFenceAtomicRanges: RangeSet<Decoration>;
}

interface FenceProtectionInputs {
  readonly allFencedBlocks: readonly FencedBlockInfo[];
  readonly protectedDivs: readonly FencedDivInfo[];
  readonly codeBlocks: readonly CodeBlockInfo[];
  readonly displayMathBlocks: readonly DisplayMathBlockInfo[];
}

const closingFenceAtomicMark = Decoration.mark({});

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

function buildClosingFenceRanges(
  state: EditorState,
  protectedDivs: readonly FencedDivInfo[],
  codeBlocks: readonly CodeBlockInfo[],
  displayMathBlocks: readonly DisplayMathBlockInfo[],
): FenceRange[] {
  const ranges: FenceRange[] = [];
  const seen = new Set<number>();

  for (const div of protectedDivs) {
    if (div.closeFenceFrom < 0) continue;
    const line = state.doc.lineAt(div.closeFenceFrom);
    if (!seen.has(line.from)) {
      seen.add(line.from);
      ranges.push({ from: line.from, to: line.to });
    }
  }

  for (const block of codeBlocks) {
    if (block.singleLine || block.closeFenceFrom < 0) continue;
    const line = state.doc.lineAt(block.closeFenceFrom);
    if (!seen.has(line.from)) {
      seen.add(line.from);
      ranges.push({ from: line.from, to: line.to });
    }
  }

  for (const block of displayMathBlocks) {
    const line = state.doc.lineAt(block.closeFenceFrom);
    if (!seen.has(line.from)) {
      seen.add(line.from);
      ranges.push({ from: line.from, to: line.to });
    }
  }

  return ranges;
}

function buildOpeningFenceColonRanges(
  state: EditorState,
  protectedDivs: readonly FencedDivInfo[],
): FenceRange[] {
  const ranges: FenceRange[] = [];
  const seen = new Set<number>();
  for (const div of protectedDivs) {
    if (seen.has(div.openFenceFrom)) continue;
    seen.add(div.openFenceFrom);
    const text = state.sliceDoc(div.openFenceFrom, div.openFenceTo);
    const colonLen = countColons(text, 0);
    if (colonLen >= 3) {
      ranges.push({ from: div.openFenceFrom, to: div.openFenceFrom + colonLen });
    }
  }
  return ranges;
}

function buildOpeningFenceBacktickRanges(
  codeBlocks: readonly CodeBlockInfo[],
): FenceRange[] {
  const ranges: FenceRange[] = [];
  const seen = new Set<number>();
  for (const block of codeBlocks) {
    if (block.singleLine) continue;
    if (seen.has(block.openFenceFrom)) continue;
    seen.add(block.openFenceFrom);
    if (block.openFenceMarker.startsWith("`")) {
      ranges.push({
        from: block.openFenceFrom,
        to: block.openFenceFrom + block.openFenceMarker.length,
      });
    }
  }
  return ranges;
}

function buildOpeningMathDelimiterRanges(
  displayMathBlocks: readonly DisplayMathBlockInfo[],
): FenceRange[] {
  const ranges: FenceRange[] = [];
  const seen = new Set<number>();
  for (const block of displayMathBlocks) {
    if (seen.has(block.openFenceFrom)) continue;
    seen.add(block.openFenceFrom);
    ranges.push({
      from: block.openDelimiterFrom,
      to: block.openDelimiterFrom + block.openingDelimiter.length,
    });
  }
  return ranges;
}

function buildClosingFenceAtomicRanges(
  state: EditorState,
  fenceRanges: readonly FenceRange[],
): RangeSet<Decoration> {
  if (fenceRanges.length === 0) return Decoration.none;

  const ranges: Range<Decoration>[] = [];
  for (const fence of fenceRanges) {
    const atomicFrom = fence.from > 0 ? fence.from - 1 : fence.from;
    const atomicTo = fence.to < state.doc.length ? fence.to + 1 : fence.to;
    ranges.push(closingFenceAtomicMark.range(atomicFrom, atomicTo));
  }
  return RangeSet.of(ranges, true);
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

function didDisplayMathFenceGeometryChange(tr: Transaction): boolean {
  const before = collectDisplayMathBlocks(tr.startState);
  const after = collectDisplayMathBlocks(tr.state);
  if (!tr.docChanged) return !sameDisplayMathBlocks(before, after);
  return !sameDisplayMathBlocks(mapDisplayMathBlocks(before, tr), after);
}

function shouldRebuildFenceProtectionCache(tr: Transaction): boolean {
  if (tr.startState.field(pluginRegistryField, false) !== tr.state.field(pluginRegistryField, false)) {
    return true;
  }
  if (didSemanticsSliceChange(tr.startState, tr.state, "fencedDivs")) return true;
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

function getFenceProtectionCache(state: EditorState): FenceProtectionCache {
  return state.field(fenceProtectionCacheField, false) ?? buildFenceProtectionCache(state);
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
 * line is fully deleted. Without this, deleting a block's header leaves an
 * orphaned closing fence (`::: ` or ``` ``` ```) in the document.
 *
 * Uses collectAllFencedBlocks (not getProtectedDivs) because cleanup
 * should apply to ALL fenced blocks, including unregistered/custom types.
 *
 * The returned spec carries fenceOperationAnnotation so both protection
 * filters are bypassed for the combined structural deletion.
 */
export const openingFenceDeletionCleanup = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(fenceOperationAnnotation)) return tr;
  if (tr.annotation(programmaticDocumentChangeAnnotation)) return tr;

  const state = tr.startState;
  const blocks = collectAllFencedBlocks(state);
  if (blocks.length === 0) return tr;

  const closingFencesToRemove: { from: number; to: number }[] = [];

  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (inserted.length > 1) return;

    for (const block of blocks) {
      if (block.singleLine || block.closeFenceFrom < 0) continue;

      const openLine = state.doc.lineAt(block.openFenceFrom);

      // Full opening line deletion
      const fullLineDeletion = fromA <= openLine.from && toA >= openLine.to;

      // Partial deletion that removes the structural prefix (colons/backticks).
      // If the prefix is gone the line no longer parses as a fence, so the
      // closing delimiter must be cleaned up (#766).
      // Key off the actual prefix position, not the line start — fenced
      // blocks can be indented inside list items so openFenceFrom may be
      // past openLine.from, and code blocks set openFenceFrom to the line
      // start so the text may contain leading whitespace.
      let prefixBroken = false;
      if (!fullLineDeletion) {
        const rawText = state.sliceDoc(block.openFenceFrom, block.openFenceTo);
        // Skip leading whitespace — code blocks include indentation in
        // openFenceFrom..openFenceTo; fenced divs report openFenceFrom at
        // the first colon so indent is 0 for them.
        const indent = rawText.length - rawText.trimStart().length;
        const prefixStart = block.openFenceFrom + indent;
        const text = indent > 0 ? rawText.substring(indent) : rawText;
        const firstChar = text.charAt(0);
        let prefixEnd = -1;
        if (firstChar === ":") {
          const colonLen = countColons(text, 0);
          if (colonLen >= 3) prefixEnd = prefixStart + colonLen;
        } else if (firstChar === "`") {
          const match = /^`{3,}/.exec(text);
          if (match) prefixEnd = prefixStart + match[0].length;
        } else if (firstChar === "$" && text.startsWith("$$")) {
          prefixEnd = prefixStart + 2;
        } else if (firstChar === "\\" && text.startsWith("\\[")) {
          prefixEnd = prefixStart + 2;
        }
        if (prefixEnd > 0 && fromA <= prefixStart && toA >= prefixEnd) {
          prefixBroken = true;
        }
      }

      if (fullLineDeletion || prefixBroken) {
        if (fromA <= block.closeFenceFrom && toA >= block.closeFenceTo) continue;

        // Include the preceding newline so the line is fully removed
        const closeLine = state.doc.lineAt(block.closeFenceFrom);
        const removeFrom = closeLine.from > 0 ? closeLine.from - 1 : closeLine.from;
        const removeTo = closeLine.to < state.doc.length ? closeLine.to + 1 : closeLine.to;
        closingFencesToRemove.push({ from: removeFrom, to: removeTo });
      }
    }
  });

  if (closingFencesToRemove.length === 0) return tr;

  const changes: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({ from: fromA, to: toA, insert: inserted.toString() });
  });
  for (const c of closingFencesToRemove) {
    changes.push({ from: c.from, to: c.to, insert: "" });
  }
  // CM6 requires changes sorted by position and non-overlapping.
  // Nested block deletion can produce overlapping closing-fence ranges
  // (e.g. a parent and child both schedule removal of adjacent/overlapping
  // fence lines). Merge them so CM6 doesn't crash on overlapping changes.
  changes.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: typeof changes = [];
  for (const c of changes) {
    const prev = merged.length > 0 ? merged[merged.length - 1] : null;
    if (prev && prev.insert === "" && c.insert === "" && c.from <= prev.to) {
      // Overlapping or adjacent deletion ranges — merge into one
      prev.to = Math.max(prev.to, c.to);
    } else {
      merged.push({ ...c });
    }
  }

  return {
    changes: merged,
    annotations: fenceOperationAnnotation.of(true),
  };
});

/**
 * Transaction filter that protects closing fence lines from accidental deletion.
 *
 * Covers both fenced divs and fenced code blocks. Blocks any edit that touches
 * only the closing fence line content. Whole-block deletion (selection covering
 * the entire fenced block) is still allowed so that Cmd+A + Delete works.
 */
export const closingFenceProtection = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  // Bypass for programmatic fence operations (block-type picker, etc.)
  if (tr.annotation(fenceOperationAnnotation)) return tr;
  if (tr.annotation(programmaticDocumentChangeAnnotation)) return tr;

  const fenceRanges = getClosingFenceRanges(tr.startState);
  if (fenceRanges.length === 0) return tr;

  const docLen = tr.startState.doc.length;
  let blocked = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (blocked) return;
    for (const fence of fenceRanges) {
      if (fromA <= fence.to && toA >= fence.from) {
        // Account for document boundaries: start-of-doc counts as "before",
        // end-of-doc counts as "after".
        const extendsBeforeFence = fromA < fence.from - 1 || fromA === 0;
        const extendsAfterFence = toA >= fence.to + 1 || toA >= docLen;
        if (extendsBeforeFence && extendsAfterFence) continue;
        // Allow if it's a replacement that includes the fence (structural edit)
        if (inserted.length > 0 && extendsBeforeFence) continue;
        // Block: the edit targets only the closing fence
        blocked = true;
        return;
      }
    }
  });

  return blocked ? [] : tr;
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
export const openingFenceColonProtection = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(fenceOperationAnnotation)) return tr;
  if (tr.annotation(programmaticDocumentChangeAnnotation)) return tr;

  const colonRanges = getOpeningFenceColonRanges(tr.startState);
  if (colonRanges.length === 0) return tr;

  let blocked = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (blocked) return;
    for (const colon of colonRanges) {
      if (fromA <= colon.to && toA >= colon.from) {
        if (fromA === toA) continue; // pure insertion
        if (fromA >= colon.to) continue; // editing attrs/title after colons
        // Whole-block deletion: spans past colons on both sides
        const atOrBeforeStart = fromA <= colon.from;
        const pastColonEnd = toA > colon.to;
        if (atOrBeforeStart && pastColonEnd) continue;
        if (inserted.length > 0 && fromA < colon.from) continue; // structural replacement
        blocked = true;
        return;
      }
    }
  });

  return blocked ? [] : tr;
});

/**
 * Transaction filter that protects opening code-fence backtick prefixes.
 *
 * Mirrors openingFenceColonProtection for fenced divs: edits that target only
 * the opening ``` prefix are blocked, while language/info-string edits and
 * whole-block deletion remain allowed.
 */
export const openingFenceBacktickProtection = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(fenceOperationAnnotation)) return tr;
  if (tr.annotation(programmaticDocumentChangeAnnotation)) return tr;

  const backtickRanges = getOpeningFenceBacktickRanges(tr.startState);
  if (backtickRanges.length === 0) return tr;

  let blocked = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (blocked) return;
    for (const backticks of backtickRanges) {
      if (fromA <= backticks.to && toA >= backticks.from) {
        if (fromA === toA) continue; // pure insertion
        if (fromA >= backticks.to) continue; // editing language/info string after backticks
        const atOrBeforeStart = fromA <= backticks.from;
        const pastBacktickEnd = toA > backticks.to;
        if (atOrBeforeStart && pastBacktickEnd) continue;
        if (inserted.length > 0 && fromA < backticks.from) continue; // structural replacement
        blocked = true;
        return;
      }
    }
  });

  return blocked ? [] : tr;
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
export const openingFenceMathProtection = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(fenceOperationAnnotation)) return tr;
  if (tr.annotation(programmaticDocumentChangeAnnotation)) return tr;

  const delimRanges = getOpeningMathDelimiterRanges(tr.startState);
  if (delimRanges.length === 0) return tr;

  let blocked = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (blocked) return;
    for (const delim of delimRanges) {
      if (fromA <= delim.to && toA >= delim.from) {
        if (fromA === toA) continue; // pure insertion
        if (fromA >= delim.to) continue; // editing after delimiter
        const atOrBeforeStart = fromA <= delim.from;
        // Unlike colon/backtick protection (which uses strict >), math
        // delimiters use >= because the delimiter IS the entire opening
        // line content — there are no attrs/title after it. Covering the
        // full delimiter is an intentional deletion that the cleanup
        // filter should handle.
        const coversFullDelim = toA >= delim.to;
        if (atOrBeforeStart && coversFullDelim) continue;
        if (inserted.length > 0 && fromA < delim.from) continue; // structural replacement
        blocked = true;
        return;
      }
    }
  });

  return blocked ? [] : tr;
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
export const pairedMathEntry = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to) return false; // has selection

  const state = view.state;
  const line = state.doc.lineAt(from);

  if (text === "$") {
    // Check if completing $$ on a (possibly indented) otherwise-blank line.
    // `before` contains everything from line start to cursor; trim leading
    // whitespace so indented lines (e.g. inside a list) still match.
    const before = state.sliceDoc(line.from, from);
    const beforeTrimmed = before.trimStart();
    if (beforeTrimmed !== "$") return false;
    const after = state.sliceDoc(from, line.to).trim();
    if (after !== "") return false;

    // Bracket-match skip: don't auto-insert if next non-blank line is $$
    for (let n = line.number + 1; n <= state.doc.lines; n++) {
      const trimmed = state.doc.line(n).text.trim();
      if (trimmed === "") continue;
      if (trimmed === "$$") return false;
      break;
    }

    // Preserve indentation: keep the leading whitespace on all three lines.
    const indent = before.slice(0, before.length - beforeTrimmed.length);
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: `${indent}$$\n\n${indent}$$` },
      selection: { anchor: line.from + indent.length + 3 },
      annotations: fenceOperationAnnotation.of(true),
    });
    return true;
  }

  if (text === "[") {
    // Check if completing \[ on a (possibly indented) otherwise-blank line.
    const before = state.sliceDoc(line.from, from);
    const beforeTrimmed = before.trimStart();
    if (beforeTrimmed !== "\\") return false;
    const after = state.sliceDoc(from, line.to).trim();
    if (after !== "") return false;

    // Bracket-match skip: don't auto-insert if next non-blank line is \]
    for (let n = line.number + 1; n <= state.doc.lines; n++) {
      const trimmed = state.doc.line(n).text.trim();
      if (trimmed === "") continue;
      if (trimmed === "\\]") return false;
      break;
    }

    // Preserve indentation: keep the leading whitespace on all three lines.
    const indent = before.slice(0, before.length - beforeTrimmed.length);
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: `${indent}\\[\n\n${indent}\\]` },
      selection: { anchor: line.from + indent.length + 3 },
      annotations: fenceOperationAnnotation.of(true),
    });
    return true;
  }

  return false;
});

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
export const emptyMathBlockBackspaceCleanup = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(fenceOperationAnnotation)) return tr;
  if (tr.annotation(programmaticDocumentChangeAnnotation)) return tr;

  const state = tr.startState;

  // Only handle single-change, single-character deletions (backspace/delete)
  let deleteFrom = -1;
  let deleteTo = -1;
  let changeCount = 0;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changeCount++;
    if (changeCount === 1 && inserted.length === 0 && toA - fromA === 1) {
      deleteFrom = fromA;
      deleteTo = toA;
    }
  });
  if (changeCount !== 1 || deleteFrom < 0) return tr;

  // The line containing deleteFrom should be a math opening delimiter
  const openLine = state.doc.lineAt(deleteFrom);
  const openText = openLine.text.trim();

  let closingDelimiter: string;
  if (openText === "$$") closingDelimiter = "$$";
  else if (openText === "\\[") closingDelimiter = "\\]";
  else return tr;

  // The deletion must cross a line boundary (joining the content line up)
  if (deleteTo <= openLine.to) return tr;

  // The line being joined should be blank (empty content)
  const contentLine = state.doc.lineAt(deleteTo);
  if (contentLine.text.trim() !== "") return tr;

  // All lines from contentLine forward must be blank until the closing delimiter
  let closingLine: { from: number; to: number } | null = null;
  for (let n = contentLine.number; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    const trimmed = l.text.trim();
    if (trimmed === "") continue;
    if (trimmed === closingDelimiter) closingLine = { from: l.from, to: l.to };
    break;
  }
  if (!closingLine) return tr;

  // Remove the entire block (opening + blank content + closing)
  let removeFrom = openLine.from;
  let removeTo = closingLine.to;
  if (removeTo < state.doc.length) removeTo += 1; // include trailing newline
  else if (removeFrom > 0) removeFrom -= 1; // include preceding newline

  return {
    changes: { from: removeFrom, to: removeTo, insert: "" },
    annotations: fenceOperationAnnotation.of(true),
  };
});

/**
 * Combined CM6 extension for all fence protection behavior.
 *
 * Covers fenced divs, fenced code blocks (#441), and display math (#777).
 *
 * CM6 runs transactionFilters in reverse registration order, so cleanup
 * (registered first) executes AFTER protections have already passed/blocked.
 */
export const fenceProtectionExtension: Extension = [
  fenceProtectionCacheField,
  openingFenceDeletionCleanup,
  emptyMathBlockBackspaceCleanup,
  closingFenceProtection,
  openingFenceColonProtection,
  openingFenceBacktickProtection,
  openingFenceMathProtection,
  pairedMathEntry,
  closingFenceAtomicRanges,
];

export { fenceProtectionCacheField as _fenceProtectionCacheFieldForTest };
