import type {
  DecorationSet,
} from "@codemirror/view";
import type {
  EditorState,
  Text,
  Transaction,
} from "@codemirror/state";
import type { MathSemantics } from "../semantics/document";
import {
  type DirtyRange,
  dirtyRangesFromChanges,
  expandChangeRange,
  mergeDirtyRanges,
  rangeIntersectsDirtyRanges,
} from "./incremental-dirty-ranges";

function firstMathRegionWithToAfter(
  regions: readonly MathSemantics[],
  pos: number,
): number {
  let low = 0;
  let high = regions.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (regions[mid].to <= pos) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function firstMathRegionWithToAtLeast(
  regions: readonly MathSemantics[],
  pos: number,
): number {
  let low = 0;
  let high = regions.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (regions[mid].to < pos) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function forEachMathRegionIntersectingRange(
  regions: readonly MathSemantics[],
  range: DirtyRange,
  visit: (region: MathSemantics) => void,
): void {
  if (range.from === range.to) return;
  const startIndex = firstMathRegionWithToAfter(regions, range.from);
  for (let index = startIndex; index < regions.length; index += 1) {
    const region = regions[index];
    if (region.from >= range.to) break;
    visit(region);
  }
}

function forEachMathRegionTouchingChange(
  regions: readonly MathSemantics[],
  change: DirtyRange,
  visit: (region: MathSemantics) => void,
): void {
  if (change.from === change.to) {
    const startIndex = firstMathRegionWithToAtLeast(regions, change.from);
    for (let index = startIndex; index < regions.length; index += 1) {
      const region = regions[index];
      if (region.from > change.from) break;
      visit(region);
    }
    return;
  }

  forEachMathRegionIntersectingRange(regions, change, visit);
}

function mapMathRegionDirtyRange(
  region: Pick<MathSemantics, "from" | "to">,
  changes: { mapPos: (pos: number, assoc?: number) => number },
): DirtyRange {
  const from = changes.mapPos(region.from, -1);
  return {
    from,
    to: Math.max(from, changes.mapPos(region.to, 1)),
  };
}

export interface MathChangeSummary {
  readonly changedMathDirtyRanges: readonly DirtyRange[];
  readonly hasMathSyntaxEdit: boolean;
  readonly touchesExistingMath: boolean;
}

function containsMathSyntaxEdit(text: string): boolean {
  return /[$\\()[\]{}#\r\n]/.test(text);
}

function textContainsMathSyntaxEdit(text: Text): boolean {
  const cursor = text.iter();
  while (!cursor.next().done) {
    if (containsMathSyntaxEdit(cursor.value)) {
      return true;
    }
  }
  return false;
}

function sliceChangeContext(
  state: EditorState,
  from: number,
  to: number,
): string {
  return state.sliceDoc(
    Math.max(0, from - 1),
    Math.min(state.doc.length, Math.max(from, to) + 1),
  );
}

export function summarizeMathChanges(
  tr: Transaction,
  regionsBefore: readonly MathSemantics[],
  regionsAfter: readonly MathSemantics[],
): MathChangeSummary {
  const dirtyRanges: DirtyRange[] = [];
  let hasMathSyntaxEdit = false;
  let touchesExistingMath = false;

  tr.changes.iterChanges((fromOld, toOld, fromNew, toNew, inserted) => {
    if (
      !hasMathSyntaxEdit
      && (
        textContainsMathSyntaxEdit(inserted)
        || containsMathSyntaxEdit(sliceChangeContext(tr.startState, fromOld, toOld))
        || containsMathSyntaxEdit(sliceChangeContext(tr.state, fromNew, toNew))
      )
    ) {
      hasMathSyntaxEdit = true;
    }

    const oldChange = { from: fromOld, to: Math.max(fromOld, toOld) };
    const newChange = { from: fromNew, to: Math.max(fromNew, toNew) };

    forEachMathRegionTouchingChange(regionsBefore, oldChange, (region) => {
      touchesExistingMath = true;
      dirtyRanges.push(mapMathRegionDirtyRange(region, tr.changes));
    });

    forEachMathRegionTouchingChange(regionsAfter, newChange, (region) => {
      dirtyRanges.push({ from: region.from, to: region.to });
    });
  }, true);

  return {
    changedMathDirtyRanges: mergeDirtyRanges(dirtyRanges),
    hasMathSyntaxEdit,
    touchesExistingMath,
  };
}

export function collectDirtyMathRegions(
  regions: readonly MathSemantics[],
  dirtyRanges: readonly DirtyRange[],
): MathSemantics[] {
  if (dirtyRanges.length === 0) return [];
  const dirty: MathSemantics[] = [];
  let lastDirtyRegion: MathSemantics | undefined;
  for (const range of dirtyRanges) {
    forEachMathRegionIntersectingRange(regions, range, (region) => {
      if (region === lastDirtyRegion) return;
      dirty.push(region);
      lastDirtyRegion = region;
    });
  }
  return dirty;
}

export function docChangeCanShiftMathDecorations(
  tr: Transaction,
  regionsBefore: readonly MathSemantics[],
): boolean {
  if (!tr.docChanged || regionsBefore.length === 0) return false;
  const lastMathTo = regionsBefore[regionsBefore.length - 1].to;

  let canShift = false;
  tr.changes.iterChangedRanges((fromOld) => {
    if (fromOld <= lastMathTo) {
      canShift = true;
    }
  });
  return canShift;
}

export function docChangeCanShiftDecorationSet(
  decorations: DecorationSet,
  tr: Transaction,
): boolean {
  let maxTo = -1;
  const cursor = decorations.iter();
  while (cursor.value) {
    maxTo = Math.max(maxTo, cursor.to);
    cursor.next();
  }
  if (maxTo < 0) return false;
  if (maxTo > tr.state.doc.length) return true;

  let canShift = false;
  tr.changes.iterChangedRanges((fromOld) => {
    if (fromOld <= maxTo) {
      canShift = true;
    }
  });
  return canShift;
}

export function collectActiveMathDirtyRanges(
  tr: Transaction,
  activeChanged: boolean,
  beforeActive: Pick<MathSemantics, "from" | "to"> | null | undefined,
  afterActive: Pick<MathSemantics, "from" | "to"> | null | undefined,
): DirtyRange[] {
  if (!activeChanged) return [];

  const ranges: DirtyRange[] = [];
  if (beforeActive) {
    ranges.push(tr.docChanged ? mapMathRegionDirtyRange(beforeActive, tr.changes) : beforeActive);
  }
  if (afterActive) {
    ranges.push(afterActive);
  }
  return mergeDirtyRanges(ranges);
}

export function decorationIntersectsMathDirtyRanges(
  from: number,
  to: number,
  dirtyRanges: readonly DirtyRange[],
): boolean {
  if (rangeIntersectsDirtyRanges(from, to, dirtyRanges)) {
    return true;
  }
  if (from !== to) {
    return false;
  }
  return dirtyRanges.some((range) => from === range.to);
}

export function collectMathDirtyRanges(
  tr: Transaction,
  docChangeOnlyShiftsMath: boolean,
  changedMathDirtyRanges: readonly DirtyRange[],
): readonly DirtyRange[] {
  if (docChangeOnlyShiftsMath || changedMathDirtyRanges.length === 0) {
    return [];
  }
  return [
    ...dirtyRangesFromChanges(tr.changes, expandChangeRange),
    ...changedMathDirtyRanges,
  ];
}
