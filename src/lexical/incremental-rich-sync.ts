import { $generateNodesFromSerializedNodes } from "@lexical/clipboard";
import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  $setSelection,
  type EditorUpdateOptions,
  type LexicalEditor,
  type LexicalNode,
  type SerializedLexicalNode,
} from "lexical";

import { createMinimalEditorDocumentChanges, type EditorDocumentChange } from "../lib/editor-doc-change";
import { measureSync } from "../lib/perf";
import { parseMarkdownFragmentToJSON } from "./headless-markdown-parse";
import {
  DISPLAY_MATH_BRACKET_BLOCK_START_RE,
  DISPLAY_MATH_DOLLAR_START_RE,
  FOOTNOTE_DEFINITION_START_RE,
  FRONTMATTER_DELIMITER_RE,
  GRID_TABLE_SEPARATOR_RE,
  IMAGE_BLOCK_START_RE,
  matchDisplayMathEndLine,
  matchFencedDivEndLine,
  matchFencedDivStartLine,
  matchFootnoteDefinitionEndLine,
  matchGridTableEndLine,
  matchRawEquationEndLine,
  matchTableEndLine,
  RAW_EQUATION_START_RE,
} from "./markdown/block-scanner";
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

const PLAIN_PARAGRAPH_MARKDOWN_MARKER_RE = /[*_`[\]\\$<>|#@:!]/;
const PLAIN_PARAGRAPH_BLOCK_START_RE =
  /^\s{0,3}(?:#{1,6}(?:\s|$)|[-+*](?:\s|$)|\d{1,9}[.)](?:\s|$)|>(?:\s|$)|:{3,}|\|)/;
const THEMATIC_BREAK_LINE_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

function measureIncrementalRichSync<T>(branch: string, task: () => T): T {
  return measureSync(`lexical.incrementalRichSync.${branch}`, task, {
    category: "lexical",
  });
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

function matchSourceBlockEndLine(lines: readonly string[], lineIndex: number): number {
  const line = lines[lineIndex] ?? "";

  if (lineIndex === 0 && FRONTMATTER_DELIMITER_RE.test(line)) {
    for (let endLineIndex = 1; endLineIndex < lines.length; endLineIndex += 1) {
      if (FRONTMATTER_DELIMITER_RE.test(lines[endLineIndex] ?? "")) {
        return endLineIndex;
      }
    }
    return -1;
  }

  const fencedMatch = matchFencedDivStartLine(line);
  if (fencedMatch) {
    return matchFencedDivEndLine(lines, lineIndex, fencedMatch, {
      allowLongerClosingFence: true,
      nested: true,
    });
  }

  if (DISPLAY_MATH_DOLLAR_START_RE.test(line) || DISPLAY_MATH_BRACKET_BLOCK_START_RE.test(line)) {
    return matchDisplayMathEndLine(lines, lineIndex);
  }

  if (RAW_EQUATION_START_RE.test(line)) {
    return matchRawEquationEndLine(lines, lineIndex);
  }

  if (IMAGE_BLOCK_START_RE.test(line)) {
    return lineIndex;
  }

  if (GRID_TABLE_SEPARATOR_RE.test(line)) {
    return matchGridTableEndLine(lines, lineIndex);
  }

  if (FOOTNOTE_DEFINITION_START_RE.test(line)) {
    return matchFootnoteDefinitionEndLine(lines, lineIndex);
  }

  return matchTableEndLine(lines, lineIndex);
}

function findIncrementalSyncBlockRange(
  previousDoc: string,
  change: EditorDocumentChange,
): IncrementalSyncBlockRange | null {
  const lines = previousDoc.split("\n");
  const lineOffsets = computeLineOffsets(lines);
  let index = 0;

  for (let lineIndex = 0; lineIndex < lines.length;) {
    const sourceBlockEndLine = matchSourceBlockEndLine(lines, lineIndex);
    const range = sourceBlockEndLine >= 0
      ? rangeFromLineSpan(lines, lineOffsets, lineIndex, sourceBlockEndLine)
      : rangeFromLineSpan(lines, lineOffsets, lineIndex, lineIndex);
    if (change.from >= range.from && change.to <= range.to) {
      return { ...range, index };
    }
    if (change.to < range.from) {
      return null;
    }
    lineIndex = sourceBlockEndLine >= 0 ? sourceBlockEndLine + 1 : lineIndex + 1;
    index += 1;
  }

  return null;
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

function canApplyPlainParagraphTextUpdate(
  previousBlockSource: string,
  nextBlockSource: string,
): boolean {
  return (
    previousBlockSource.trim().length > 0
    && nextBlockSource.trim().length > 0
    && !previousBlockSource.includes("\n")
    && !nextBlockSource.includes("\n")
    && !PLAIN_PARAGRAPH_BLOCK_START_RE.test(previousBlockSource)
    && !PLAIN_PARAGRAPH_BLOCK_START_RE.test(nextBlockSource)
    && !THEMATIC_BREAK_LINE_RE.test(previousBlockSource)
    && !THEMATIC_BREAK_LINE_RE.test(nextBlockSource)
    && !PLAIN_PARAGRAPH_MARKDOWN_MARKER_RE.test(previousBlockSource)
    && !PLAIN_PARAGRAPH_MARKDOWN_MARKER_RE.test(nextBlockSource)
  );
}

function applyPlainParagraphTextUpdate(
  topLevel: LexicalNode,
  previousBlockSource: string,
  nextBlockSource: string,
): boolean {
  if (
    topLevel.getType() !== "paragraph"
    || !canApplyPlainParagraphTextUpdate(previousBlockSource, nextBlockSource)
    || !$isElementNode(topLevel)
    || topLevel.getTextContent() !== previousBlockSource
  ) {
    return false;
  }

  const children = topLevel.getChildren();
  if (children.length !== 1 || !$isTextNode(children[0])) {
    return false;
  }
  if (children[0].getFormat() !== 0 || children[0].getStyle() !== "") {
    return false;
  }

  children[0].setTextContent(nextBlockSource);
  return true;
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
    measureIncrementalRichSync("editorUpdate", () => editor.update(() => {
      const blockRange = measureIncrementalRichSync(
        "findBlockRange",
        () => findIncrementalSyncBlockRange(previousDoc, change),
      );
      if (!blockRange) {
        return;
      }
      const rootChildren = measureIncrementalRichSync(
        "getRootChildren",
        () => $getRoot().getChildren(),
      );
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
        rawBlockTarget ??= measureIncrementalRichSync(
          "findRawBlockTarget",
          () => findRawBlockTargetContainingChange(
            rootChildren,
            previousDoc,
            change,
          ),
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
        previousBlocks ??= measureIncrementalRichSync(
          "parsePreviousBlock",
          () => parseMarkdownFragmentToJSON(previousBlockSource),
        );
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
      } else if (!rawSourceMatch && topLevel.getTextContent() !== previousBlockSource) {
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

      const nextBlockTo = blockTo + delta;
      if (nextBlockTo < blockFrom || nextBlockTo > nextDoc.length) {
        return;
      }

      const nextBlockSource = nextDoc.slice(blockFrom, nextBlockTo);
      const textUpdateTarget = topLevel;
      if (
        measureIncrementalRichSync(
          "applyPlainParagraphTextUpdate",
          () => applyPlainParagraphTextUpdate(
            textUpdateTarget,
            previousBlockSource,
            nextBlockSource,
          ),
        )
      ) {
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

      const parsedBlocks = measureIncrementalRichSync(
        "parseNextBlock",
        () => parseMarkdownFragmentToJSON(nextBlockSource),
      );
      if (parsedBlocks.length !== 1) {
        return;
      }
      const [replacement] = measureIncrementalRichSync(
        "generateReplacement",
        () => $generateNodesFromSerializedNodes([...parsedBlocks]),
      );
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
      skipTransforms: true,
      tag: options?.tag,
    }));
  }, { category: "lexical", detail: `${nextDoc.length} chars` });

  return result;
}
