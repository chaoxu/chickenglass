import type { SelectionRange } from "@codemirror/state";

export interface InlineRevealTarget {
  readonly from: number;
  readonly to: number;
}

export function selectionTouchesInlineTarget(
  selection: SelectionRange,
  target: InlineRevealTarget,
): boolean {
  return selection.from >= target.from && selection.to <= target.to;
}

export function findFocusedInlineRevealTarget<T extends InlineRevealTarget>(
  selection: SelectionRange,
  targets: readonly T[],
  focused: boolean,
  matches: (target: T) => boolean = () => true,
): T | null {
  if (!focused) return null;
  for (const target of targets) {
    if (!matches(target)) continue;
    if (selectionTouchesInlineTarget(selection, target)) {
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
