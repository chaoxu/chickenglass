import type { ChangeDesc, EditorState } from "@codemirror/state";
import type { FencedDivSemantics } from "../semantics/document";
import { compareRangesByFromThenTo } from "../lib/range-order";
import { containsPos } from "../lib/range-helpers";
import { documentSemanticsField } from "../state/document-analysis";

export interface FencedBlockPositionMapper {
  mapPos(pos: number, assoc?: number): number;
}

/** Shared document ranges for blocks bounded by an opening and closing fence line. */
export interface FencedBlockInfo {
  readonly from: number;
  readonly to: number;
  readonly openFenceFrom: number;
  readonly openFenceTo: number;
  readonly closeFenceFrom: number;
  readonly closeFenceTo: number;
  readonly singleLine: boolean;
}

/** Full info about a fenced div, combining block geometry and semantics. */
export interface FencedDivInfo extends FencedBlockInfo, FencedDivSemantics {
  readonly className: string;
}

export interface DisplayMathBlockInfo extends FencedBlockInfo {
  readonly openDelimiterFrom: number;
  readonly openingDelimiter: "$$" | "\\[";
  readonly closingDelimiter: "$$" | "\\]";
  readonly closeLineTo: number;
}

interface FencedDivGeometryInfo extends FencedBlockInfo {
  readonly attrFrom?: number;
  readonly attrTo?: number;
  readonly titleFrom?: number;
  readonly titleTo?: number;
}

const fencedDivInfoCache = new WeakMap<object, FencedDivInfo[]>();
const fencedDivStructureRangeCache = new WeakMap<
  object,
  readonly { readonly from: number; readonly to: number }[]
>();

function mapSentinelPos(
  pos: number,
  changes: FencedBlockPositionMapper,
  assoc: number,
): number {
  return pos < 0 ? pos : changes.mapPos(pos, assoc);
}

function mapOptionalPos(
  pos: number | undefined,
  changes: FencedBlockPositionMapper,
  assoc: number,
): number | undefined {
  return pos === undefined ? undefined : changes.mapPos(pos, assoc);
}

/**
 * Extract info about FencedDiv nodes from the shared semantics field.
 * Returns an empty array if the semantics field is not present in the state
 * (e.g. in minimal test configurations).
 */
export function collectFencedDivs(state: EditorState): FencedDivInfo[] {
  const semantics = state.field(documentSemanticsField, false);
  if (!semantics) return [];
  const cached = fencedDivInfoCache.get(semantics as object);
  if (cached) return cached;
  const collected = semantics.fencedDivs
    .filter((div): div is FencedDivSemantics & { primaryClass: string } => Boolean(div.primaryClass))
    .map((div) => ({
      ...div,
      className: div.primaryClass,
    }));
  fencedDivInfoCache.set(semantics as object, collected);
  return collected;
}

export function collectFencedDivStructureRanges(
  state: EditorState,
): readonly { readonly from: number; readonly to: number }[] {
  const semantics = state.field(documentSemanticsField, false);
  if (!semantics) return [];
  const cached = fencedDivStructureRangeCache.get(semantics as object);
  if (cached) return cached;

  const ranges: { from: number; to: number }[] = [];
  for (const div of semantics.fencedDivs) {
    ranges.push({ from: div.openFenceFrom, to: div.openFenceTo });
    if (
      div.attrFrom !== undefined
      && div.attrTo !== undefined
      && div.attrFrom < div.attrTo
    ) {
      ranges.push({ from: div.attrFrom, to: div.attrTo });
    }
    if (
      div.titleFrom !== undefined
      && div.titleTo !== undefined
      && div.titleFrom < div.titleTo
    ) {
      ranges.push({ from: div.titleFrom, to: div.titleTo });
    }
    if (div.closeFenceFrom >= 0 && div.closeFenceFrom < div.closeFenceTo) {
      ranges.push({ from: div.closeFenceFrom, to: div.closeFenceTo });
    }
  }
  ranges.sort(compareRangesByFromThenTo);
  fencedDivStructureRangeCache.set(semantics as object, ranges);
  return ranges;
}

function rangesTouchSortedRanges(
  from: number,
  to: number,
  ranges: readonly { readonly from: number; readonly to: number }[],
): boolean {
  for (const range of ranges) {
    if (range.from > to) return false;
    if (range.to >= from && range.from <= to) return true;
  }
  return false;
}

export function docChangeTouchesFencedDivStructure(
  tr: { readonly startState: EditorState; readonly state: EditorState; readonly changes: ChangeDesc },
): boolean {
  const beforeRanges = collectFencedDivStructureRanges(tr.startState);
  const afterRanges = collectFencedDivStructureRanges(tr.state);
  let touched = false;
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (touched) return;
    touched = rangesTouchSortedRanges(fromA, toA, beforeRanges)
      || rangesTouchSortedRanges(fromB, toB, afterRanges);
  });
  return touched;
}

/**
 * Collect multi-line display math blocks as FencedBlockInfo for protection.
 * Reads from documentSemanticsField.mathRegions, filtering for isDisplay.
 * The opening fence is the $$ or \[ line; the closing fence is the $$ or \] line.
 *
 * `closeFenceTo` is set to the end of the delimiter characters only (not any
 * trailing label like `{#eq:energy}`), so callers can protect only the
 * delimiter itself and leave the label editable.
 */
export function collectDisplayMathBlocks(state: EditorState): DisplayMathBlockInfo[] {
  const semantics = state.field(documentSemanticsField, false);
  if (!semantics) return [];

  const results: DisplayMathBlockInfo[] = [];
  for (const region of semantics.mathRegions) {
    if (!region.isDisplay) continue;

    const openLine = state.doc.lineAt(region.from);
    const openText = state.sliceDoc(openLine.from, openLine.to);
    const openTrimmed = openText.trimStart();
    const openIndent = openText.length - openTrimmed.length;
    const openingDelimiter = openTrimmed.startsWith("$$")
      ? "$$"
      : openTrimmed.startsWith("\\[")
      ? "\\["
      : null;
    if (!openingDelimiter) continue;

    const closeLine = state.doc.lineAt(region.contentTo);
    if (closeLine.from === openLine.from) continue;
    const closeText = state.sliceDoc(region.contentTo, closeLine.to);
    const closeTrimmed = closeText.trimStart();
    const closeIndent = closeText.length - closeTrimmed.length;
    const closingDelimiter = closeTrimmed.startsWith("$$")
      ? "$$"
      : closeTrimmed.startsWith("\\]")
      ? "\\]"
      : null;
    if (!closingDelimiter) continue;

    const closeDelimTo = region.labelFrom !== undefined
      ? region.labelFrom
      : region.contentTo + closeIndent + closingDelimiter.length;

    results.push({
      from: region.from,
      to: region.to,
      openFenceFrom: openLine.from,
      openFenceTo: openLine.to,
      closeFenceFrom: closeLine.from,
      closeFenceTo: closeDelimTo,
      singleLine: false,
      openDelimiterFrom: openLine.from + openIndent,
      openingDelimiter,
      closingDelimiter,
      closeLineTo: closeLine.to,
    });
  }
  return results;
}

/** Find the fenced block containing a position. */
export function findFencedBlockAt<T extends Pick<FencedBlockInfo, "from" | "to">>(
  blocks: readonly T[],
  pos: number,
): T | null {
  for (const block of blocks) {
    if (containsPos(block, pos)) return block;
  }
  return null;
}

export function mapFencedBlockInfo<T extends FencedBlockInfo>(
  block: T,
  changes: FencedBlockPositionMapper,
): T {
  const from = changes.mapPos(block.from, 1);
  const to = Math.max(from, changes.mapPos(block.to, -1));
  const openFenceFrom = changes.mapPos(block.openFenceFrom, 1);
  const openFenceTo = Math.max(openFenceFrom, changes.mapPos(block.openFenceTo, -1));
  const closeFenceFrom = mapSentinelPos(block.closeFenceFrom, changes, 1);
  const closeFenceToBase = mapSentinelPos(block.closeFenceTo, changes, -1);
  const closeFenceTo =
    closeFenceFrom < 0 || closeFenceToBase < 0
      ? closeFenceToBase
      : Math.max(closeFenceFrom, closeFenceToBase);

  if (
    from === block.from
    && to === block.to
    && openFenceFrom === block.openFenceFrom
    && openFenceTo === block.openFenceTo
    && closeFenceFrom === block.closeFenceFrom
    && closeFenceTo === block.closeFenceTo
  ) {
    return block;
  }

  return {
    ...block,
    from,
    to,
    openFenceFrom,
    openFenceTo,
    closeFenceFrom,
    closeFenceTo,
  };
}

export function mapFencedDivInfo<T extends FencedDivGeometryInfo>(
  div: T,
  changes: FencedBlockPositionMapper,
): T {
  const mappedBlock = mapFencedBlockInfo(div, changes);
  const attrFrom = mapOptionalPos(div.attrFrom, changes, 1);
  const attrToBase = mapOptionalPos(div.attrTo, changes, -1);
  const attrTo =
    attrFrom === undefined || attrToBase === undefined
      ? attrToBase
      : Math.max(attrFrom, attrToBase);
  const titleFrom = mapOptionalPos(div.titleFrom, changes, 1);
  const titleToBase = mapOptionalPos(div.titleTo, changes, -1);
  const titleTo =
    titleFrom === undefined || titleToBase === undefined
      ? titleToBase
      : Math.max(titleFrom, titleToBase);

  if (
    mappedBlock === div
    && attrFrom === div.attrFrom
    && attrTo === div.attrTo
    && titleFrom === div.titleFrom
    && titleTo === div.titleTo
  ) {
    return div;
  }

  return {
    ...mappedBlock,
    attrFrom,
    attrTo,
    titleFrom,
    titleTo,
  };
}

export function mapDisplayMathBlockInfo<T extends DisplayMathBlockInfo>(
  block: T,
  changes: FencedBlockPositionMapper,
): T {
  const mappedBlock = mapFencedBlockInfo(block, changes);
  const openDelimiterFrom = changes.mapPos(block.openDelimiterFrom, 1);
  const closeLineTo = Math.max(mappedBlock.closeFenceFrom, changes.mapPos(block.closeLineTo, -1));

  if (
    mappedBlock === block
    && openDelimiterFrom === block.openDelimiterFrom
    && closeLineTo === block.closeLineTo
  ) {
    return block;
  }

  return {
    ...mappedBlock,
    openDelimiterFrom,
    closeLineTo,
  };
}

export function getFencedDivStructuralOpenTo(
  div: Pick<FencedDivSemantics, "openFenceTo" | "titleFrom">,
): number {
  return div.titleFrom ?? div.openFenceTo;
}

export function getFencedDivRevealFrom(
  div: Pick<FencedDivSemantics, "openFenceFrom" | "titleFrom">,
): number {
  return div.titleFrom ?? div.openFenceFrom;
}

export function getFencedDivRevealTo(
  div: Pick<FencedDivSemantics, "openFenceTo" | "titleTo">,
): number {
  return div.titleTo ?? div.openFenceTo;
}
