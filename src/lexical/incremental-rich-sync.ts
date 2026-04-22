import { $generateNodesFromSerializedNodes } from "@lexical/clipboard";
import {
  $getRoot,
  $setSelection,
  type EditorUpdateOptions,
  type LexicalEditor,
  type LexicalNode,
  type SerializedLexicalNode,
} from "lexical";

import { measureSync } from "../app/perf";
import { createMinimalEditorDocumentChanges, type EditorDocumentChange } from "../lib/editor-doc-change";
import { collectSourceBlockRanges, type SourceBlockRange } from "./markdown/block-scanner";
import { parseMarkdownFragmentToJSON } from "./headless-markdown-parse";
import { $isRawBlockNode, type RawBlockNode } from "./nodes/raw-block-node";

export type IncrementalRichDocumentSyncResult =
  | { readonly applied: false }
  | {
      readonly applied: true;
      readonly blockFrom: number;
      readonly blockTo: number;
      readonly nextBlockSource: string;
      readonly nextBlockTo: number;
      readonly nodeKey: string;
    };

interface IncrementalSyncBlockRangeBase {
  readonly from: number;
  readonly to: number;
}

interface IncrementalSyncBlockRange extends IncrementalSyncBlockRangeBase {
  readonly index: number;
}

const ATX_HEADING_LINE_RE = /^\s{0,3}#{1,6}(?:\s|$)/;

function computeLineOffsets(lines: readonly string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

function rangeFromLineSpan(
  lines: readonly string[],
  lineOffsets: readonly number[],
  startLineIndex: number,
  endLineIndex: number,
): IncrementalSyncBlockRangeBase {
  const from = lineOffsets[startLineIndex] ?? 0;
  const endLine = lines[endLineIndex] ?? "";
  return {
    from,
    to: (lineOffsets[endLineIndex] ?? from) + endLine.length,
  };
}

function collectIncrementalSyncBlockRanges(markdown: string): IncrementalSyncBlockRangeBase[] {
  const lines = markdown.split("\n");
  const lineOffsets = computeLineOffsets(lines);
  const sourceBlocksByStartLine = new Map<number, SourceBlockRange>(
    collectSourceBlockRanges(markdown).map((range) => [range.startLineIndex, range]),
  );
  const ranges: IncrementalSyncBlockRangeBase[] = [];

  for (let lineIndex = 0; lineIndex < lines.length;) {
    const line = lines[lineIndex] ?? "";
    if (line.trim().length === 0) {
      ranges.push(rangeFromLineSpan(lines, lineOffsets, lineIndex, lineIndex));
      lineIndex += 1;
      continue;
    }

    const sourceBlock = sourceBlocksByStartLine.get(lineIndex);
    if (sourceBlock) {
      ranges.push({ from: sourceBlock.from, to: sourceBlock.to });
      lineIndex = sourceBlock.endLineIndex + 1;
      continue;
    }

    if (ATX_HEADING_LINE_RE.test(line)) {
      ranges.push(rangeFromLineSpan(lines, lineOffsets, lineIndex, lineIndex));
      lineIndex += 1;
      continue;
    }

    ranges.push(rangeFromLineSpan(lines, lineOffsets, lineIndex, lineIndex));
    lineIndex += 1;
  }

  return ranges;
}

function findIncrementalSyncBlockRange(
  previousDoc: string,
  change: EditorDocumentChange,
): IncrementalSyncBlockRange | null {
  const ranges = collectIncrementalSyncBlockRanges(previousDoc);
  const index = ranges.findIndex((range) =>
    change.from >= range.from && change.to <= range.to
  );
  if (index < 0) {
    return null;
  }
  return { ...ranges[index], index };
}

interface RawBlockTarget {
  readonly from: number;
  readonly node: RawBlockNode;
  readonly source: string;
  readonly to: number;
}

function findRawBlockTargetContainingChange(
  rootChildren: readonly LexicalNode[],
  previousDoc: string,
  change: EditorDocumentChange,
): RawBlockTarget | null {
  let searchFrom = 0;
  for (const child of rootChildren) {
    if (!$isRawBlockNode(child)) {
      continue;
    }

    const source = child.getRaw();
    if (source.length === 0) {
      continue;
    }

    const from = previousDoc.indexOf(source, searchFrom);
    if (from < 0) {
      return null;
    }
    const to = from + source.length;
    if (change.from >= from && change.to <= to) {
      return { from, node: child, source, to };
    }
    searchFrom = to;
  }
  return null;
}

function hasMultipleRawBlocksBySource(
  rootChildren: readonly LexicalNode[],
  source: string,
): boolean {
  let seen = false;
  for (const child of rootChildren) {
    if (!$isRawBlockNode(child) || child.getRaw() !== source) {
      continue;
    }
    if (seen) {
      return true;
    }
    seen = true;
  }
  return false;
}

interface BlockIdentity {
  readonly text: string;
  readonly type: string;
}

function blockIdentityFromSerializedBlock(
  block: SerializedLexicalNode,
): BlockIdentity | null {
  const [node] = $generateNodesFromSerializedNodes([block]);
  return node
    ? {
        text: node.getTextContent(),
        type: node.getType(),
      }
    : null;
}

function findUniqueTopLevelByIdentity(
  rootChildren: readonly LexicalNode[],
  identity: BlockIdentity,
): LexicalNode | null {
  let match: LexicalNode | null = null;
  for (const child of rootChildren) {
    if (child.getType() !== identity.type || child.getTextContent() !== identity.text) {
      continue;
    }
    if (match) {
      return null;
    }
    match = child;
  }
  return match;
}

function isRawBlockBodyOnlyChange(
  previousBlockSource: string,
  change: EditorDocumentChange,
  blockFrom: number,
): boolean {
  if (
    change.from !== change.to
    || /[\n\r\\:$]/.test(change.insert)
  ) {
    return false;
  }
  const firstLineEnd = previousBlockSource.indexOf("\n");
  const lastLineStart = previousBlockSource.lastIndexOf("\n");
  if (firstLineEnd < 0 || lastLineStart <= firstLineEnd) {
    return false;
  }
  const relativeFrom = change.from - blockFrom;
  const relativeTo = change.to - blockFrom;
  return relativeFrom > firstLineEnd && relativeTo < lastLineStart;
}

export function applyIncrementalRichDocumentSync(
  editor: LexicalEditor,
  previousDoc: string,
  nextDoc: string,
  options?: Pick<EditorUpdateOptions, "tag">,
): IncrementalRichDocumentSyncResult {
  const changes = createMinimalEditorDocumentChanges(previousDoc, nextDoc);
  if (changes.length !== 1) {
    return { applied: false };
  }

  const [change] = changes;
  const replacedLength = change.to - change.from;
  const delta = change.insert.length - replacedLength;
  let result: IncrementalRichDocumentSyncResult = { applied: false };

  measureSync("lexical.incrementalRichSync", () => {
    editor.update(() => {
      const blockRange = findIncrementalSyncBlockRange(previousDoc, change);
      if (!blockRange) {
        return;
      }
      const rootChildren = $getRoot().getChildren();
      let blockFrom = blockRange.from;
      let blockTo = blockRange.to;
      if (change.from < blockFrom || change.to > blockTo) {
        return;
      }
      let previousBlockSource = previousDoc.slice(blockFrom, blockTo);
      let topLevel: LexicalNode | null = rootChildren[blockRange.index] ?? null;
      let rawSourceMatch = $isRawBlockNode(topLevel) && topLevel.getRaw() === previousBlockSource
        ? topLevel
        : null;
      let rawBlockTarget: RawBlockTarget | null | undefined;
      let previousBlocks: SerializedLexicalNode[] | null = null;
      const clearPreviousBlockCache = () => {
        previousBlocks = null;
        previousIdentity = undefined;
      };
      const useRawBlockTarget = (): boolean => {
        rawBlockTarget ??= findRawBlockTargetContainingChange(
          rootChildren,
          previousDoc,
          change,
        );
        if (!rawBlockTarget) {
          return false;
        }
        blockFrom = rawBlockTarget.from;
        blockTo = rawBlockTarget.to;
        previousBlockSource = rawBlockTarget.source;
        topLevel = rawBlockTarget.node;
        rawSourceMatch = rawBlockTarget.node;
        clearPreviousBlockCache();
        return true;
      };
      const getPreviousBlocks = () => {
        previousBlocks ??= parseMarkdownFragmentToJSON(previousBlockSource);
        return previousBlocks;
      };
      let previousIdentity: BlockIdentity | null | undefined;
      const getPreviousIdentity = () => {
        if (previousIdentity !== undefined) {
          return previousIdentity;
        }
        const blocks = getPreviousBlocks();
        previousIdentity = blocks.length === 1 && blocks[0]
          ? blockIdentityFromSerializedBlock(blocks[0])
          : null;
        return previousIdentity;
      };
      const findParsedTopLevelMatch = () => {
        const identity = getPreviousIdentity();
        return identity ? findUniqueTopLevelByIdentity(rootChildren, identity) : null;
      };
      if (rawSourceMatch && hasMultipleRawBlocksBySource(rootChildren, previousBlockSource)) {
        useRawBlockTarget();
      }
      if (
        rawSourceMatch
        && (
          topLevel?.getType() !== "coflat-raw-block"
          || ($isRawBlockNode(topLevel) && topLevel.getRaw() !== previousBlockSource)
        )
      ) {
        topLevel = rawSourceMatch;
      }
      if (
        !topLevel
        || (topLevel.getType() !== "paragraph" && topLevel.getType() !== "coflat-raw-block")
      ) {
        topLevel = findParsedTopLevelMatch();
        if (!topLevel) {
          useRawBlockTarget();
        }
      } else if (!rawSourceMatch) {
        const identity = getPreviousIdentity();
        if (
          identity
          && (topLevel.getType() !== identity.type || topLevel.getTextContent() !== identity.text)
        ) {
          const parsedMatch = findUniqueTopLevelByIdentity(rootChildren, identity);
          if (parsedMatch && !parsedMatch.is(topLevel)) {
            topLevel = parsedMatch;
          } else if (!parsedMatch) {
            useRawBlockTarget();
          }
        }
      }
      if (!topLevel) {
        return;
      }
      const topLevelType = topLevel.getType();
      if (topLevelType !== "paragraph" && topLevelType !== "coflat-raw-block") {
        return;
      }

      let restoresRawBlockReveal = false;
      if (topLevelType === "coflat-raw-block") {
        if (!$isRawBlockNode(topLevel)) {
          return;
        }
        if (topLevel.getRaw() !== previousBlockSource) {
          if (!rawSourceMatch || !$isRawBlockNode(rawSourceMatch)) {
            return;
          }
          topLevel = rawSourceMatch;
        }
      } else {
        const previousBlocks = getPreviousBlocks();
        restoresRawBlockReveal = previousBlocks.length === 1
          && previousBlocks[0]?.type === "coflat-raw-block"
          && topLevel.getTextContent() === previousBlockSource;
        if (
          previousBlocks.length !== 1
          || (previousBlocks[0]?.type !== topLevelType && !restoresRawBlockReveal)
        ) {
          return;
        }
      }

      const nextBlockTo = blockTo + delta;
      if (nextBlockTo < blockFrom || nextBlockTo > nextDoc.length) {
        return;
      }

      const nextBlockSource = nextDoc.slice(blockFrom, nextBlockTo);
      if (
        topLevelType === "coflat-raw-block"
        && $isRawBlockNode(topLevel)
        && isRawBlockBodyOnlyChange(previousBlockSource, change, blockFrom)
      ) {
        topLevel.setRaw(nextBlockSource);
        result = {
          applied: true,
          blockFrom,
          blockTo,
          nextBlockSource,
          nextBlockTo,
          nodeKey: topLevel.getKey(),
        };
        return;
      }

      const parsedBlocks = parseMarkdownFragmentToJSON(nextBlockSource);
      if (parsedBlocks.length !== 1) {
        return;
      }
      const [replacement] = $generateNodesFromSerializedNodes([...parsedBlocks]);
      const replacementType = replacement?.getType() ?? null;
      if (topLevelType === "paragraph"
        && !restoresRawBlockReveal
        && /\n\s*\n/.test(nextBlockSource)) {
        return;
      }
      if (
        !replacement
        || (replacementType !== topLevelType
          && !(restoresRawBlockReveal && replacementType === "coflat-raw-block"))
      ) {
        return;
      }

      $setSelection(null);
      topLevel.replace(replacement);
      result = {
        applied: true,
        blockFrom,
        blockTo,
        nextBlockSource,
        nextBlockTo,
        nodeKey: replacement.getKey(),
      };
    }, {
      discrete: true,
      tag: options?.tag,
    });
  }, { category: "lexical", detail: `${nextDoc.length} chars` });

  return result;
}
