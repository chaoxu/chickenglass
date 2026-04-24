import { measureSync } from "../lib/perf";
import {
  collectSourceBlockRanges,
  type SourceBlockRange,
} from "./markdown/block-scanner";
import type { SourceBlockPositionAssignment } from "./source-block-position-assignment";
import {
  clearSourceRange,
  readSourceFrom,
  readSourceTo,
  SOURCE_BLOCK_SELECTOR,
  SOURCE_POSITION_ATTR,
  setSourceRange,
} from "./source-position-contract";

function readSourceBlockNodeKey(element: HTMLElement): string | null {
  return element.getAttribute(SOURCE_POSITION_ATTR.sourceBlockNodeKey);
}

function sourceRangeKey(range: Pick<SourceBlockRange, "from" | "to">): string {
  return `${range.from}:${range.to}`;
}

export function syncSourceBlockPositions(
  root: HTMLElement | null,
  doc: string,
  assignments: ReadonlyMap<string, SourceBlockPositionAssignment> = new Map(),
  sourceBlockRanges?: readonly SourceBlockRange[],
): void {
  if (!root) {
    return;
  }

  const elements = [...root.querySelectorAll<HTMLElement>(SOURCE_BLOCK_SELECTOR)]
    .filter((element) => element.closest(".cf-lexical-root") === root);
  if (elements.length === 0) {
    return;
  }

  measureSync("source.syncSourceBlockPositions", () => {
    const ranges = sourceBlockRanges ?? collectSourceBlockRanges(doc);
    const assignedRanges = new Set<string>();
    const fallbackElements: HTMLElement[] = [];
    for (const element of elements) {
      const nodeKey = readSourceBlockNodeKey(element);
      const assignment = nodeKey ? assignments.get(nodeKey) : undefined;
      if (!assignment) {
        fallbackElements.push(element);
        continue;
      }

      setSourceRange(element, assignment.from, assignment.to);
      assignedRanges.add(sourceRangeKey(assignment));
    }

    let rangeCursor = 0;
    fallbackElements.forEach((element) => {
      while (rangeCursor < ranges.length) {
        const range = ranges[rangeCursor];
        if (!range || !assignedRanges.has(sourceRangeKey(range))) {
          break;
        }
        rangeCursor += 1;
      }
      const range = ranges[rangeCursor];
      if (!range) {
        clearSourceRange(element);
        return;
      }
      setSourceRange(element, range.from, range.to);
      rangeCursor += 1;
    });
  }, {
    detail: root.className,
  });
}

export function hasCompleteSourceBlockRanges(root: HTMLElement): boolean {
  const elements = [...root.querySelectorAll<HTMLElement>(SOURCE_BLOCK_SELECTOR)]
    .filter((element) => element.closest(".cf-lexical-root") === root);
  return elements.length > 0 && elements.every((element) =>
    readSourceFrom(element) !== null && readSourceTo(element) !== null
  );
}

export function hasSourceBlockElements(root: HTMLElement | null): boolean {
  if (!root) {
    return false;
  }
  return [...root.querySelectorAll<HTMLElement>(SOURCE_BLOCK_SELECTOR)]
    .some((element) => element.closest(".cf-lexical-root") === root);
}
