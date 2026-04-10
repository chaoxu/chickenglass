import type { SelectionRange } from "@codemirror/state";
import { containsRange } from "../lib/range-helpers";

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
  for (const target of targets) {
    if (!matches(target)) continue;
    if (isFocusedInlineRevealTarget(selection, target, focused)) {
      return target;
    }
  }
  return null;
}

export function inlineRevealTargetChanged(
  before: InlineRevealTarget | null | undefined,
  after: InlineRevealTarget | null | undefined,
): boolean {
  return before?.from !== after?.from || before?.to !== after?.to;
}
