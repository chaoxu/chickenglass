import { $generateNodesFromSerializedNodes } from "@lexical/clipboard";
import { $getRoot, $setSelection, type EditorUpdateOptions, type LexicalEditor } from "lexical";

import { measureSync } from "../app/perf";
import { createMinimalEditorDocumentChanges, type EditorDocumentChange } from "../lib/editor-doc-change";
import { collectSourceBlockRanges, type SourceBlockRange } from "./markdown/block-scanner";
import { parseMarkdownFragmentToJSON } from "./headless-markdown-parse";
import { $isRawBlockNode } from "./nodes/raw-block-node";

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
    if ((lines[lineIndex] ?? "").trim().length === 0) {
      lineIndex += 1;
      continue;
    }

    const sourceBlock = sourceBlocksByStartLine.get(lineIndex);
    if (sourceBlock) {
      ranges.push({ from: sourceBlock.from, to: sourceBlock.to });
      lineIndex = sourceBlock.endLineIndex + 1;
      continue;
    }

    const startLineIndex = lineIndex;
    while (
      lineIndex + 1 < lines.length
      && (lines[lineIndex + 1] ?? "").trim().length > 0
      && !sourceBlocksByStartLine.has(lineIndex + 1)
    ) {
      lineIndex += 1;
    }
    ranges.push(rangeFromLineSpan(lines, lineOffsets, startLineIndex, lineIndex));
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
      const topLevel = rootChildren[blockRange.index] ?? null;
      if (!topLevel) {
        return;
      }
      const topLevelType = topLevel.getType();
      if (topLevelType !== "paragraph" && topLevelType !== "coflat-raw-block") {
        return;
      }

      const blockFrom = blockRange.from;
      const blockTo = blockRange.to;
      if (change.from < blockFrom || change.to > blockTo) {
        return;
      }
      const previousBlockSource = previousDoc.slice(blockFrom, blockTo);
      let restoresRawBlockReveal = false;
      if (topLevelType === "coflat-raw-block") {
        if (!$isRawBlockNode(topLevel)) {
          return;
        }
      } else {
        const previousBlocks = parseMarkdownFragmentToJSON(previousBlockSource);
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
