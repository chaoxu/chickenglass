import {
  EditorState,
  type Transaction,
  RangeSet,
  StateField,
} from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
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
import { EXCLUDED_FROM_FALLBACK } from "../constants/block-manifest";
import {
  codeBlockStructureField,
  collectCodeBlocks,
  getCodeBlockStructureRevision,
  type CodeBlockInfo,
} from "../state/code-block-structure";
import { createChangeChecker } from "../state/change-detection";
import {
  documentSemanticsField,
  getDocumentAnalysisSliceRevision,
} from "../state/document-analysis";
import { pluginRegistryField } from "../state/plugin-registry";
import {
  buildClosingFenceAtomicRanges,
  buildClosingFenceRanges,
  buildOpeningFenceBacktickRanges,
  buildOpeningFenceColonRanges,
  buildOpeningMathDelimiterRanges,
} from "./fence-builders";
import type { FenceRange } from "./fence-protection-pipeline";
import {
  type PluginRegistryState,
  getPluginOrFallback,
} from "./plugin-registry";

export interface FenceProtectionCache {
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
    closingFenceAtomicRanges: buildClosingFenceAtomicRanges(closingFenceRanges),
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

export function docChangeCouldAffectDisplayMathFences(tr: Transaction): boolean {
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

export const fenceProtectionCacheField = StateField.define<FenceProtectionCache>({
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

export function getFenceProtectionCache(state: EditorState): FenceProtectionCache {
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
export function collectAllFencedBlocks(state: EditorState): readonly FencedBlockInfo[] {
  return getFenceProtectionCache(state).allFencedBlocks;
}
