import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { EditorState, StateField, type Transaction } from "@codemirror/state";
import {
  type FencedBlockInfo,
  mapFencedBlockInfo,
} from "../fenced-block/model";
import { mergeRanges, rangesOverlap } from "../lib/range-helpers";

export interface CodeBlockInfo extends FencedBlockInfo {
  /** Start of the FencedCode node (opening fence line start). */
  readonly from: number;
  /** End of the FencedCode node (closing fence line end). */
  readonly to: number;
  /** Language identifier (empty string if none). */
  readonly language: string;
  /** Opening fence marker run (` ``` ` or `~~~`). */
  readonly openFenceMarker: string;
}

export interface CodeBlockStructureCache {
  readonly blocks: readonly CodeBlockInfo[];
  readonly structureRevision: number;
}

interface DirtyRange {
  readonly from: number;
  readonly to: number;
}

const OPEN_CODE_FENCE_RE = /^\s*([`~]{3,})/;

function isValidCodeBlockInfo(
  state: EditorState,
  block: CodeBlockInfo,
): boolean {
  if (
    block.from < 0
    || block.to <= block.from
    || block.to > state.doc.length
    || block.openFenceFrom < 0
    || block.openFenceTo <= block.openFenceFrom
    || block.openFenceTo > state.doc.length
    || block.closeFenceFrom < 0
    || block.closeFenceTo <= block.closeFenceFrom
    || block.closeFenceTo > state.doc.length
    || block.openFenceFrom > block.from
    || block.closeFenceTo < block.to
  ) {
    return false;
  }

  const openLine = state.doc.lineAt(block.openFenceFrom);
  if (
    block.openFenceFrom !== openLine.from
    || block.openFenceTo !== openLine.to
  ) {
    return false;
  }

  return OPEN_CODE_FENCE_RE.test(openLine.text);
}

function sanitizeCodeBlocks(
  state: EditorState,
  blocks: readonly CodeBlockInfo[],
): readonly CodeBlockInfo[] {
  let filtered: CodeBlockInfo[] | null = null;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (isValidCodeBlockInfo(state, block)) {
      filtered?.push(block);
      continue;
    }

    if (filtered === null) {
      filtered = blocks.slice(0, index);
    }
  }

  return filtered ?? blocks;
}

function createCodeBlockInfo(
  state: EditorState,
  nodeFrom: number,
  nodeTo: number,
  language: string,
): CodeBlockInfo | null {
  if (nodeFrom < 0 || nodeTo <= nodeFrom || nodeTo > state.doc.length) {
    return null;
  }

  const openLine = state.doc.lineAt(nodeFrom);
  const closeLine = state.doc.lineAt(nodeTo);
  const openFenceText = state.doc.sliceString(openLine.from, openLine.to);
  const openFenceMarker = OPEN_CODE_FENCE_RE.exec(openFenceText)?.[1] ?? "";

  const block = {
    from: nodeFrom,
    to: nodeTo,
    openFenceFrom: openLine.from,
    openFenceTo: openLine.to,
    closeFenceFrom: closeLine.from,
    closeFenceTo: closeLine.to,
    singleLine: closeLine.from === openLine.from,
    language,
    openFenceMarker,
  };
  return isValidCodeBlockInfo(state, block) ? block : null;
}

/** Extract info about FencedCode nodes from the syntax tree. */
function scanCodeBlocks(
  state: EditorState,
  ranges?: readonly DirtyRange[],
): readonly CodeBlockInfo[] {
  const results: CodeBlockInfo[] = [];
  const seen = new Set<number>();
  const tree = syntaxTree(state);

  const collectInRange = (from?: number, to?: number) => {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.type.name !== "FencedCode" || seen.has(node.from)) return;
        seen.add(node.from);

        let language = "";
        const codeInfoNode = node.node.getChild("CodeInfo");
        if (codeInfoNode) {
          language = state.doc.sliceString(codeInfoNode.from, codeInfoNode.to).trim();
        }

        const block = createCodeBlockInfo(state, node.from, node.to, language);
        if (block) {
          results.push(block);
        }
      },
    });
  };

  if (ranges) {
    for (const range of ranges) {
      collectInRange(range.from, range.to);
    }
    results.sort((left, right) => left.from - right.from);
    return results;
  }

  collectInRange();
  return results;
}

function sameCodeBlockInfo(
  left: CodeBlockInfo,
  right: CodeBlockInfo,
): boolean {
  return left.from === right.from
    && left.to === right.to
    && left.openFenceFrom === right.openFenceFrom
    && left.openFenceTo === right.openFenceTo
    && left.closeFenceFrom === right.closeFenceFrom
    && left.closeFenceTo === right.closeFenceTo
    && left.singleLine === right.singleLine
    && left.language === right.language
    && left.openFenceMarker === right.openFenceMarker;
}

function sameCodeBlockLists(
  left: readonly CodeBlockInfo[],
  right: readonly CodeBlockInfo[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!sameCodeBlockInfo(left[index], right[index])) return false;
  }
  return true;
}

function mapCodeBlock(
  block: CodeBlockInfo,
  tr: Transaction,
): CodeBlockInfo {
  const mappedBlock = mapFencedBlockInfo(block, tr.changes);
  const singleLine = mappedBlock.closeFenceFrom === mappedBlock.openFenceFrom;

  if (mappedBlock === block && singleLine === block.singleLine) {
    return block;
  }

  if (singleLine === mappedBlock.singleLine) return mappedBlock;

  return { ...mappedBlock, singleLine };
}

function mapCodeBlocks(
  blocks: readonly CodeBlockInfo[],
  tr: Transaction,
): readonly CodeBlockInfo[] {
  let changed = false;
  const mapped = blocks.map((block) => {
    const next = mapCodeBlock(block, tr);
    if (next !== block) changed = true;
    return next;
  });
  return changed ? mapped : blocks;
}

function touchesCodeBlockFence(
  from: number,
  to: number,
  block: Pick<CodeBlockInfo, "openFenceFrom" | "openFenceTo" | "closeFenceFrom" | "closeFenceTo" | "singleLine">,
): boolean {
  if (rangesOverlap({ from, to }, { from: block.openFenceFrom, to: block.openFenceTo })) {
    return true;
  }
  if (block.singleLine) return false;
  return rangesOverlap({ from, to }, { from: block.closeFenceFrom, to: block.closeFenceTo });
}

function computeCodeBlockStructureDirtyRanges(
  blocks: readonly CodeBlockInfo[],
  tr: Transaction,
): readonly DirtyRange[] {
  const dirtyRanges: DirtyRange[] = [];

  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    let dirtyFrom = Number.POSITIVE_INFINITY;
    let dirtyTo = Number.NEGATIVE_INFINITY;

    for (const block of blocks) {
      if (block.from > toA) break;
      if (!touchesCodeBlockFence(fromA, toA, block)) continue;
      dirtyFrom = Math.min(dirtyFrom, tr.changes.mapPos(block.from, 1));
      dirtyTo = Math.max(dirtyTo, tr.changes.mapPos(block.to, -1));
    }

    const newBlocks = scanCodeBlocks(tr.state, [{ from: fromB, to: toB }]);
    for (const block of newBlocks) {
      if (!touchesCodeBlockFence(fromB, toB, block)) continue;
      dirtyFrom = Math.min(dirtyFrom, block.from);
      dirtyTo = Math.max(dirtyTo, block.to);
    }

    if (dirtyFrom <= dirtyTo) {
      dirtyRanges.push({ from: dirtyFrom, to: dirtyTo });
    }
  });

  return mergeRanges(dirtyRanges, 1);
}

function codeBlockOverlapsDirtyRanges(
  block: CodeBlockInfo,
  dirtyRanges: readonly DirtyRange[],
): boolean {
  for (const range of dirtyRanges) {
    if (range.to < block.from) continue;
    if (range.from > block.to) break;
    if (rangesOverlap(block, range)) return true;
  }
  return false;
}

function buildCodeBlockStructureCache(
  blocks: readonly CodeBlockInfo[],
  structureRevision = 0,
): CodeBlockStructureCache {
  return { blocks, structureRevision };
}

function incrementalCodeBlockStructureUpdate(
  value: CodeBlockStructureCache,
  tr: Transaction,
): CodeBlockStructureCache {
  const mappedBlocks = sanitizeCodeBlocks(tr.state, mapCodeBlocks(value.blocks, tr));
  const dirtyRanges = computeCodeBlockStructureDirtyRanges(value.blocks, tr);
  if (dirtyRanges.length === 0) {
    return mappedBlocks === value.blocks
      ? value
      : buildCodeBlockStructureCache(mappedBlocks, value.structureRevision);
  }

  const rebuiltBlocks = scanCodeBlocks(tr.state, dirtyRanges);
  const preservedBlocks: CodeBlockInfo[] = [];
  for (const block of mappedBlocks) {
    if (codeBlockOverlapsDirtyRanges(block, dirtyRanges)) continue;
    preservedBlocks.push(block);
  }

  const nextBlocks = sanitizeCodeBlocks(
    tr.state,
    [...preservedBlocks, ...rebuiltBlocks].sort((left, right) => left.from - right.from),
  );
  if (sameCodeBlockLists(nextBlocks, mappedBlocks)) {
    return buildCodeBlockStructureCache(mappedBlocks, value.structureRevision);
  }

  return buildCodeBlockStructureCache(nextBlocks, value.structureRevision + 1);
}

function updateCodeBlockStructureCache(
  value: CodeBlockStructureCache,
  tr: Transaction,
  treeAvailable = syntaxTreeAvailable(tr.state, tr.state.doc.length),
): CodeBlockStructureCache {
  if (tr.docChanged) {
    if (!treeAvailable) {
      const mappedBlocks = sanitizeCodeBlocks(tr.state, mapCodeBlocks(value.blocks, tr));
      return buildCodeBlockStructureCache(mappedBlocks, value.structureRevision);
    }
    return incrementalCodeBlockStructureUpdate(value, tr);
  }
  if (
    syntaxTree(tr.state) !== syntaxTree(tr.startState) &&
    treeAvailable
  ) {
    const blocks = scanCodeBlocks(tr.state);
    if (sameCodeBlockLists(blocks, value.blocks)) return value;
    return buildCodeBlockStructureCache(blocks, value.structureRevision + 1);
  }
  return value;
}

function getCodeBlockStructureCache(
  state: EditorState,
): CodeBlockStructureCache | null {
  return state.field(codeBlockStructureField, false) ?? null;
}

/**
 * Shared code-block structure cache for the current document/tree.
 *
 * Rich-mode consumers should read this field via collectCodeBlocks() instead
 * of rewalking the full syntax tree on cursor, hover, or handler-only updates.
 */
export const codeBlockStructureField = StateField.define<CodeBlockStructureCache>({
  create(state) {
    return buildCodeBlockStructureCache(scanCodeBlocks(state));
  },

  update(value, tr) {
    return updateCodeBlockStructureCache(value, tr);
  },
});

export { updateCodeBlockStructureCache as _updateCodeBlockStructureCacheForTest };

export function getCodeBlockStructureRevision(state: EditorState): number {
  return getCodeBlockStructureCache(state)?.structureRevision ?? 0;
}

/**
 * Return code-block structure from the shared cache when present, and fall back
 * to a one-off tree walk in isolated test states that don't install the field.
 */
export function collectCodeBlocks(state: EditorState): readonly CodeBlockInfo[] {
  const cachedBlocks = getCodeBlockStructureCache(state)?.blocks;
  // State-field updates sanitize before caching, but read-side validation is a
  // deliberate safety net during aggressive file switches if stale mapped
  // blocks ever survive long enough to be observed by another consumer.
  return cachedBlocks ? sanitizeCodeBlocks(state, cachedBlocks) : scanCodeBlocks(state);
}
