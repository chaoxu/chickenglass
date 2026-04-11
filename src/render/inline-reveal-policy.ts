import type { SelectionRange } from "@codemirror/state";
import { containsRange } from "../lib/range-helpers";
import { forEachOverlappingOrderedRange } from "../lib/range-helpers";

export interface InlineRevealTarget {
  readonly from: number;
  readonly to: number;
}

export function selectionTouchesInlineTarget(
  selection: SelectionRange,
  target: InlineRevealTarget,
): boolean {
  return containsRange(target, selection);
}

export function isFocusedInlineRevealTarget(
  selection: SelectionRange,
  target: InlineRevealTarget,
  focused: boolean,
): boolean {
  return focused && selectionTouchesInlineTarget(selection, target);
}

export function findFocusedInlineRevealTarget<T extends InlineRevealTarget>(
  selection: SelectionRange,
  targets: readonly T[],
  focused: boolean,
  matches: (target: T) => boolean = () => true,
): T | null {
  if (!focused || targets.length === 0) {
    return null;
  }

  let matched: T | null = null;
  forEachOverlappingOrderedRange(
    targets,
    { from: selection.from, to: selection.to },
    (target) => {
      if (matched || !matches(target)) return;
      if (containsRange(target, selection)) {
        matched = target;
      }
    },
  );
  return matched;
}

export function inlineRevealTargetChanged(
  before: InlineRevealTarget | null | undefined,
  after: InlineRevealTarget | null | undefined,
): boolean {
  return before?.from !== after?.from || before?.to !== after?.to;
}
