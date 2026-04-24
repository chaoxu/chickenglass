import { type TableRange } from "../state/table-discovery";
import {
  type HiddenWidgetStop,
  type WidgetStopIndex,
  firstHiddenWidgetStopBetweenLines,
  firstTableStopBetweenLines,
  hiddenWidgetStopAtPos,
  tableStopAtPos,
} from "./widget-stop-index";

export const SUSPICIOUS_STRUCTURE_EXIT_LINE_DELTA = 25;

export type VerticalMotionStopPlan =
  | { readonly kind: "hidden-crossed"; readonly stop: HiddenWidgetStop }
  | { readonly kind: "table-crossed"; readonly table: TableRange }
  | { readonly kind: "hidden-landed"; readonly stop: HiddenWidgetStop }
  | { readonly kind: "table-landed"; readonly table: TableRange };

export function hasReversedVerticalDirection(
  beforeLine: number,
  targetLine: number,
  forward: boolean,
): boolean {
  return forward ? targetLine < beforeLine : targetLine > beforeLine;
}

export function shouldFallbackRootMotion(
  beforeLine: number,
  targetLine: number,
  forward: boolean,
): boolean {
  return hasReversedVerticalDirection(beforeLine, targetLine, forward);
}

export function shouldCorrectStructureExit(
  beforeLine: number,
  targetLine: number,
  insideActiveStructure: boolean,
  forward: boolean,
): boolean {
  if (insideActiveStructure) return false;
  return Math.abs(targetLine - beforeLine) > SUSPICIOUS_STRUCTURE_EXIT_LINE_DELTA ||
    hasReversedVerticalDirection(beforeLine, targetLine, forward);
}

export function planVerticalMotionStop(
  index: WidgetStopIndex,
  beforeLine: number,
  rawTargetLine: number,
  landedHead: number,
  forward: boolean,
): VerticalMotionStopPlan | null {
  const hiddenWidgetStop = firstHiddenWidgetStopBetweenLines(
    index,
    beforeLine,
    rawTargetLine,
    forward,
  );
  if (hiddenWidgetStop) {
    return { kind: "hidden-crossed", stop: hiddenWidgetStop };
  }

  const crossedTableStop = firstTableStopBetweenLines(
    index,
    beforeLine,
    rawTargetLine,
    forward,
  );
  if (crossedTableStop) {
    return { kind: "table-crossed", table: crossedTableStop };
  }

  const landedWidgetStop = hiddenWidgetStopAtPos(index, landedHead);
  if (landedWidgetStop) {
    return { kind: "hidden-landed", stop: landedWidgetStop };
  }

  const landedTableStop = tableStopAtPos(index, landedHead);
  if (landedTableStop) {
    return { kind: "table-landed", table: landedTableStop };
  }

  return null;
}
