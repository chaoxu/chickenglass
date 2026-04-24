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
import { findSourceBoundaryRangeContainingChange } from "../lib/markdown/block-scanner";
import { measureSync } from "../lib/perf";
import { parseMarkdownFragmentToJSON } from "./headless-markdown-parse";
import {
  parseMarkdownSourceTokens,
  type ParsedSourceToken,
} from "./markdown/source-tokenizer";
import { $isFootnoteReferenceNode } from "./nodes/footnote-reference-node";
import { $isInlineImageNode } from "./nodes/inline-image-node";
import { $isInlineMathNode } from "./nodes/inline-math-node";
import { $isRawBlockNode, type RawBlockNode } from "./nodes/raw-block-node";
import { $isReferenceNode } from "./nodes/reference-node";
import {
  createNodeSourceSpanIndex,
  type SourceRevealSpan,
  type SourceTextSpan,
} from "./source-spans";

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

interface IncrementalSyncBlockRange {
  readonly from: number;
  readonly index: number;
  readonly to: number;
}

const PLAIN_PARAGRAPH_MARKDOWN_MARKER_RE = /[*_`[\]\\$<>|#@:!]/;
const PLAIN_PARAGRAPH_BLOCK_START_RE =
  /^\s{0,3}(?:#{1,6}(?:\s|$)|[-+*](?:\s|$)|\d{1,9}[.)](?:\s|$)|>(?:\s|$)|:{3,}|\|)/;
const THEMATIC_BREAK_LINE_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LARGE_RICH_TEXT_SPAN_UPDATE_MIN_SOURCE_LENGTH = 512;

function measureIncrementalRichSync<T>(branch: string, task: () => T): T {
  return measureSync(`lexical.incrementalRichSync.${branch}`, task, {
    category: "lexical",
  });
}

function findIncrementalSyncBlockRange(
  previousDoc: string,
  change: EditorDocumentChange,
): IncrementalSyncBlockRange | null {
  const range = findSourceBoundaryRangeContainingChange(previousDoc, change, {
    includeFootnoteTerminatingBlank: true,
  });
  return range ? { from: range.from, index: range.index, to: range.to } : null;
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

function applyMappedTextSpanUpdate(
  topLevel: LexicalNode,
  previousBlockSource: string,
  nextBlockSource: string,
  blockFrom: number,
  change: EditorDocumentChange,
): boolean {
  if (
    topLevel.getType() !== "paragraph"
    || previousBlockSource.length < LARGE_RICH_TEXT_SPAN_UPDATE_MIN_SOURCE_LENGTH
    || /[\n\r]/.test(change.insert)
    || PLAIN_PARAGRAPH_MARKDOWN_MARKER_RE.test(change.insert)
  ) {
    return false;
  }

  const spanIndex = measureIncrementalRichSync(
    "createNodeSourceSpanIndex",
    () => createNodeSourceSpanIndex(topLevel, previousBlockSource, blockFrom),
  );
  const span = spanIndex.spans.find((candidate): candidate is SourceTextSpan =>
    candidate.kind === "text"
    && candidate.from <= change.from
    && change.to <= candidate.to
  );
  if (!span) {
    return false;
  }

  const relativeSpanFrom = span.from - blockFrom;
  const relativeSpanTo = span.to - blockFrom;
  const previousSourceText = previousBlockSource.slice(relativeSpanFrom, relativeSpanTo);
  const previousText = span.node.getTextContent();
  if (previousSourceText !== previousText) {
    return false;
  }

  const relativeChangeFrom = change.from - span.from;
  const relativeChangeTo = change.to - span.from;
  const nextText = [
    previousText.slice(0, relativeChangeFrom),
    change.insert,
    previousText.slice(relativeChangeTo),
  ].join("");
  const nextSourceText = nextBlockSource.slice(
    relativeSpanFrom,
    relativeSpanTo + change.insert.length - (change.to - change.from),
  );
  if (nextSourceText !== nextText) {
    return false;
  }

  if (!textUpdatePreservesTokenShape(
    previousBlockSource,
    nextBlockSource,
    change.from - blockFrom,
    change.to - blockFrom,
    change.insert.length - (change.to - change.from),
  )) {
    return false;
  }

  span.node.setTextContent(nextText);
  return true;
}

function sameTextFormats(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameTokenPayload(left: ParsedSourceToken, right: ParsedSourceToken): boolean {
  if (left.kind !== right.kind || left.source !== right.source) {
    return false;
  }
  if (left.kind === "text") {
    return (
      right.kind === "text"
      && left.text === right.text
      && sameTextFormats(left.formats, right.formats)
      && left.formatSource?.source === right.formatSource?.source
    );
  }
  return right.kind === "reveal" && left.adapterId === right.adapterId;
}

function textUpdatePreservesTokenShape(
  previousBlockSource: string,
  nextBlockSource: string,
  changeFrom: number,
  changeTo: number,
  delta: number,
): boolean {
  const previousTokens = parseMarkdownSourceTokens(previousBlockSource);
  const nextTokens = parseMarkdownSourceTokens(nextBlockSource);
  const changedTokenIndex = previousTokens.findIndex((token) =>
    token.kind === "text" && token.from <= changeFrom && changeTo <= token.to
  );
  if (changedTokenIndex < 0 || previousTokens.length !== nextTokens.length) {
    return false;
  }

  return previousTokens.every((previousToken, index) => {
    const nextToken = nextTokens[index];
    if (!nextToken) {
      return false;
    }
    if (index === changedTokenIndex) {
      return (
        previousToken.kind === "text"
        && nextToken.kind === "text"
        && previousToken.from === nextToken.from
        && previousToken.to + delta === nextToken.to
        && sameTextFormats(previousToken.formats, nextToken.formats)
      );
    }
    const offset = index > changedTokenIndex ? delta : 0;
    return (
      previousToken.from + offset === nextToken.from
      && previousToken.to + offset === nextToken.to
      && sameTokenPayload(previousToken, nextToken)
    );
  });
}

function setRevealSourceRaw(node: LexicalNode, raw: string): boolean {
  if ($isInlineMathNode(node)) {
    const delimiter = raw.startsWith("\\(") ? "paren" : raw.startsWith("$") ? "dollar" : null;
    if (!delimiter) {
      return false;
    }
    node.setDelimiter(delimiter).setRaw(raw);
    return true;
  }
  if (
    $isInlineImageNode(node)
    || $isReferenceNode(node)
    || $isFootnoteReferenceNode(node)
  ) {
    node.setRaw(raw);
    return true;
  }
  return false;
}

function parsesAsSameReveal(span: SourceRevealSpan, source: string): boolean {
  const tokens = parseMarkdownSourceTokens(source);
  const [token] = tokens;
  return (
    tokens.length === 1
    && token?.kind === "reveal"
    && token.adapterId === span.adapterId
    && token.from === 0
    && token.to === source.length
    && token.source === source
  );
}

function applyMappedRevealSourceUpdate(
  topLevel: LexicalNode,
  previousBlockSource: string,
  nextBlockSource: string,
  blockFrom: number,
  change: EditorDocumentChange,
): boolean {
  if (topLevel.getType() !== "paragraph" || /[\n\r]/.test(change.insert)) {
    return false;
  }

  const spanIndex = measureIncrementalRichSync(
    "createNodeSourceSpanIndex",
    () => createNodeSourceSpanIndex(topLevel, previousBlockSource, blockFrom),
  );
  const span = spanIndex.spans.find((candidate): candidate is SourceRevealSpan =>
    candidate.kind === "reveal"
    && candidate.from <= change.from
    && change.to <= candidate.to
  );
  if (!span) {
    return false;
  }

  const relativeSpanFrom = span.from - blockFrom;
  const relativeSpanTo = span.to - blockFrom;
  const previousSource = previousBlockSource.slice(relativeSpanFrom, relativeSpanTo);
  if (previousSource !== span.source) {
    return false;
  }

  const delta = change.insert.length - (change.to - change.from);
  const relativeChangeFrom = change.from - span.from;
  const relativeChangeTo = change.to - span.from;
  const nextSource = [
    previousSource.slice(0, relativeChangeFrom),
    change.insert,
    previousSource.slice(relativeChangeTo),
  ].join("");
  if (
    nextBlockSource.slice(relativeSpanFrom, relativeSpanTo + delta) !== nextSource
    || !parsesAsSameReveal(span, nextSource)
  ) {
    return false;
  }

  return setRevealSourceRaw(span.node, nextSource);
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
        return identity
          ? measureIncrementalRichSync(
              "findUniqueTopLevelByIdentity",
              () => findUniqueTopLevelByIdentity(rootChildren, identity),
            )
          : null;
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
          const parsedMatch = measureIncrementalRichSync(
            "findUniqueTopLevelByIdentity",
            () => findUniqueTopLevelByIdentity(rootChildren, identity),
          );
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

      if (
        measureIncrementalRichSync(
          "applyMappedTextSpanUpdate",
          () => applyMappedTextSpanUpdate(
            textUpdateTarget,
            previousBlockSource,
            nextBlockSource,
            blockFrom,
            change,
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

      if (
        measureIncrementalRichSync(
          "applyMappedRevealSourceUpdate",
          () => applyMappedRevealSourceUpdate(
            textUpdateTarget,
            previousBlockSource,
            nextBlockSource,
            blockFrom,
            change,
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
