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

interface RangeQueue {
  readonly indexes: number[];
  cursor: number;
}

function queueRange(
  queues: Map<SourceBlockVariant, RangeQueue>,
  variant: SourceBlockVariant,
  index: number,
): void {
  const queue = queues.get(variant);
  if (queue) {
    queue.indexes.push(index);
    return;
  }
  queues.set(variant, { cursor: 0, indexes: [index] });
}

function queueRawRange(
  queues: Map<SourceBlockVariant, Map<string, RangeQueue>>,
  range: SourceBlockRange,
  index: number,
): void {
  let variantQueues = queues.get(range.variant);
  if (!variantQueues) {
    variantQueues = new Map();
    queues.set(range.variant, variantQueues);
  }
  const queue = variantQueues.get(range.raw);
  if (queue) {
    queue.indexes.push(index);
    return;
  }
  variantQueues.set(range.raw, { cursor: 0, indexes: [index] });
}

function takeNextUnusedRangeIndex(
  queue: RangeQueue | undefined,
  usedRangeIndexes: ReadonlySet<number>,
): number {
  if (!queue) {
    return -1;
  }
  while (queue.cursor < queue.indexes.length) {
    const index = queue.indexes[queue.cursor] ?? -1;
    queue.cursor += 1;
    if (!usedRangeIndexes.has(index)) {
      return index;
    }
  }
  return -1;
}

export function assignSourceBlockRangesToModelBlocks(
  blocks: readonly SourceBlockModelIdentity[],
  ranges: readonly SourceBlockRange[],
): Map<string, SourceBlockPositionAssignment> {
  const assignments = new Map<string, SourceBlockPositionAssignment>();
  const usedRangeIndexes = new Set<number>();
  const rangesByVariant = new Map<SourceBlockVariant, RangeQueue>();
  const rangesByVariantAndRaw = new Map<SourceBlockVariant, Map<string, RangeQueue>>();

  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    if (!range) {
      continue;
    }
    queueRange(rangesByVariant, range.variant, index);
    queueRawRange(rangesByVariantAndRaw, range, index);
  }

  for (const block of blocks) {
    const rangeIndex = block.raw === undefined
      ? takeNextUnusedRangeIndex(rangesByVariant.get(block.variant), usedRangeIndexes)
      : takeNextUnusedRangeIndex(
        rangesByVariantAndRaw.get(block.variant)?.get(block.raw),
        usedRangeIndexes,
      );
    if (rangeIndex < 0) {
      continue;
    }

    const range = ranges[rangeIndex];
    if (!range || !matchesSourceRange(block, range)) {
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
