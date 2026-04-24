import type { SourceBlockRange, SourceBlockVariant } from "./markdown/block-scanner";

export interface SourceBlockModelIdentity {
  readonly nodeKey: string;
  readonly raw?: string;
  readonly variant: SourceBlockVariant;
}

export interface SourceBlockPositionAssignment {
  readonly from: number;
  readonly nodeKey: string;
  readonly to: number;
}

function matchesSourceRange(
  block: SourceBlockModelIdentity,
  range: SourceBlockRange,
): boolean {
  if (block.variant !== range.variant) {
    return false;
  }
  return block.raw === undefined || block.raw === range.raw;
}

export function assignSourceBlockRangesToModelBlocks(
  blocks: readonly SourceBlockModelIdentity[],
  ranges: readonly SourceBlockRange[],
): Map<string, SourceBlockPositionAssignment> {
  const assignments = new Map<string, SourceBlockPositionAssignment>();
  const usedRangeIndexes = new Set<number>();

  for (const block of blocks) {
    const rangeIndex = ranges.findIndex((range, index) =>
      !usedRangeIndexes.has(index) && matchesSourceRange(block, range)
    );
    if (rangeIndex < 0) {
      continue;
    }

    const range = ranges[rangeIndex];
    if (!range) {
      continue;
    }
    usedRangeIndexes.add(rangeIndex);
    assignments.set(block.nodeKey, {
      from: range.from,
      nodeKey: block.nodeKey,
      to: range.to,
    });
  }

  return assignments;
}
