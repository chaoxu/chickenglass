import { type EditorState, type Range, RangeSet } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type {
  DisplayMathBlockInfo,
  FencedDivInfo,
} from "../fenced-block/model";
import { countColons } from "../parser";
import type { CodeBlockInfo } from "../render/code-block-render";
import type { FenceRange } from "./fence-protection-pipeline";

const closingFenceAtomicMark = Decoration.mark({});

function pushUniqueFenceRange(
  ranges: FenceRange[],
  seen: Set<number>,
  key: number,
  range: FenceRange | null,
): void {
  if (!range || seen.has(key)) return;
  seen.add(key);
  ranges.push(range);
}

export function buildClosingFenceRanges(
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
    pushUniqueFenceRange(ranges, seen, line.from, {
      from: line.from,
      to: line.to,
    });
  }

  for (const block of codeBlocks) {
    if (block.singleLine || block.closeFenceFrom < 0) continue;
    const line = state.doc.lineAt(block.closeFenceFrom);
    pushUniqueFenceRange(ranges, seen, line.from, {
      from: line.from,
      to: line.to,
    });
  }

  for (const block of displayMathBlocks) {
    const line = state.doc.lineAt(block.closeFenceFrom);
    pushUniqueFenceRange(ranges, seen, line.from, {
      from: line.from,
      to: line.to,
    });
  }

  return ranges;
}

export function buildOpeningFenceColonRanges(
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
    if (colonLen < 3) continue;
    ranges.push({ from: div.openFenceFrom, to: div.openFenceFrom + colonLen });
  }

  return ranges;
}

export function buildOpeningFenceBacktickRanges(
  codeBlocks: readonly CodeBlockInfo[],
): FenceRange[] {
  const ranges: FenceRange[] = [];
  const seen = new Set<number>();

  for (const block of codeBlocks) {
    if (block.singleLine || seen.has(block.openFenceFrom)) continue;
    seen.add(block.openFenceFrom);
    if (!block.openFenceMarker.startsWith("`")) continue;
    ranges.push({
      from: block.openFenceFrom,
      to: block.openFenceFrom + block.openFenceMarker.length,
    });
  }

  return ranges;
}

export function buildOpeningMathDelimiterRanges(
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

export function buildClosingFenceAtomicRanges(
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
