import { $isListNode } from "@lexical/list";
import {
  CHECK_LIST,
  CODE,
  type ElementTransformer,
  HEADING,
  type MultilineElementTransformer,
  ORDERED_LIST,
  QUOTE,
  TEXT_FORMAT_TRANSFORMERS,
  TEXT_MATCH_TRANSFORMERS,
  type TextMatchTransformer,
  type Transformer,
  UNORDERED_LIST,
} from "@lexical/markdown";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import type { ElementNode, Klass, LexicalNode, TextNode } from "lexical";

import {
  findNextInlineMathSource,
  INLINE_MATH_DOLLAR_IMPORT_RE,
  INLINE_MATH_DOLLAR_SHORTCUT_RE,
  INLINE_MATH_PAREN_IMPORT_RE,
  INLINE_MATH_PAREN_SHORTCUT_RE,
} from "../lib/inline-math-source";
import { HEADING_TRAILING_ATTRIBUTES_RE } from "../lib/markdown/heading-syntax";
import {
  MARKDOWN_IMAGE_IMPORT_RE,
  MARKDOWN_IMAGE_SHORTCUT_RE,
} from "../lib/markdown-image";
import { isBackslashEscaped } from "../lib/pandoc-dollar-math";
import {
  BRACKETED_REFERENCE_IMPORT_RE,
  BRACKETED_REFERENCE_SHORTCUT_RE,
  NARRATIVE_REFERENCE_IMPORT_RE,
  NARRATIVE_REFERENCE_SHORTCUT_RE,
  scanReferenceRevealTokens,
} from "../lib/reference-tokens";
import {
  type CollectSourceBlockRangesOptions,
  computeSourceLineOffsets,
  DISPLAY_MATH_BRACKET_BLOCK_START_RE,
  DISPLAY_MATH_DOLLAR_START_RE,
  FENCED_DIV_START_RE,
  FOOTNOTE_DEFINITION_START_RE,
  FRONTMATTER_DELIMITER_RE,
  GRID_TABLE_SEPARATOR_RE,
  IMAGE_BLOCK_START_RE,
  matchSourceBlockRangeAtLine,
  RAW_EQUATION_START_RE,
  type SourceBlockVariant,
} from "./markdown/block-scanner";
import {
  createTableBlockTransformer,
  createTableNodeFromMarkdown as createTableNodeFromMarkdownInner,
} from "./markdown/table-lexical";
import {
  $createFootnoteReferenceNode,
  $isFootnoteReferenceNode,
  FootnoteReferenceNode,
} from "./nodes/footnote-reference-node";
import {
  $createHeadingAttributeNode,
  $isHeadingAttributeNode,
  HeadingAttributeNode,
} from "./nodes/heading-attribute-node";
import {
  $createInlineImageNode,
  $isInlineImageNode,
  InlineImageNode,
} from "./nodes/inline-image-node";
import { $createInlineMathNode, $isInlineMathNode, InlineMathNode } from "./nodes/inline-math-node";
import { $createRawBlockNode, $isRawBlockNode, RawBlockNode, type RawBlockVariant } from "./nodes/raw-block-node";
import { $createReferenceNode, $isReferenceNode, ReferenceNode } from "./nodes/reference-node";
import { isRevealSourceStyle } from "./reveal-source-style";

const FOOTNOTE_REFERENCE_IMPORT = /\[\^[^\]\n]+\]/;
const FOOTNOTE_REFERENCE_SHORTCUT = /\[\^[^\]\n]+\]$/;

function joinRawLines(lines: readonly string[], startLineIndex: number, endLineIndex: number): string {
  return lines.slice(startLineIndex, endLineIndex + 1).join("\n");
}

function appendRawBlock(rootNode: ElementNode, variant: RawBlockVariant, raw: string): boolean {
  rootNode.append($createRawBlockNode(variant, raw));
  return true;
}

interface SourceBlockTransformerScanContext {
  readonly lineOffsets: readonly number[];
  readonly markdown: string;
}

const sourceBlockTransformerScanContexts = new WeakMap<
  readonly string[],
  SourceBlockTransformerScanContext
>();

function getSourceBlockTransformerScanContext(
  lines: readonly string[],
): SourceBlockTransformerScanContext {
  let context = sourceBlockTransformerScanContexts.get(lines);
  if (!context) {
    context = {
      lineOffsets: computeSourceLineOffsets(lines),
      markdown: lines.join("\n"),
    };
    sourceBlockTransformerScanContexts.set(lines, context);
  }
  return context;
}

function matchSourceBlockTransformerEndLine(
  lines: readonly string[],
  startLineIndex: number,
  variant: SourceBlockVariant,
  options: CollectSourceBlockRangesOptions = {},
): number {
  const { lineOffsets, markdown } = getSourceBlockTransformerScanContext(lines);
  const range = matchSourceBlockRangeAtLine(
    markdown,
    lines,
    startLineIndex,
    options,
    lineOffsets,
  );
  return range?.variant === variant ? range.endLineIndex : -1;
}

// Required end regex suppresses live shortcut conversion for raw multiline
// blocks while preserving full import through handleImportAfterStartMatch.
const NEVER_MATCH_RE = /.^/;

function createRawBlockTransformer(
  variant: RawBlockVariant,
  isMatch: (lines: readonly string[], startLineIndex: number, startMatch: RegExpMatchArray) => number,
): MultilineElementTransformer {
  return {
    dependencies: [RawBlockNode],
    export(node) {
      if ($isRawBlockNode(node) && node.getVariant() === variant) {
        return node.getRaw();
      }
      return null;
    },
    handleImportAfterStartMatch({
      lines,
      rootNode,
      startLineIndex,
      startMatch,
    }) {
      const endLineIndex = isMatch(lines, startLineIndex, startMatch);
      if (endLineIndex < 0) {
        return null;
      }
      appendRawBlock(rootNode, variant, joinRawLines(lines, startLineIndex, endLineIndex));
      return [true, endLineIndex];
    },
    regExpEnd: NEVER_MATCH_RE,
    regExpStart: /.^/,
    replace(rootNode, _children, startMatch, endMatch, linesInBetween) {
      const fragments = [startMatch[0]];
      if (linesInBetween) {
        fragments.push(...linesInBetween);
      }
      if (endMatch && endMatch[0] !== startMatch[0]) {
        fragments.push(endMatch[0]);
      }
      return appendRawBlock(rootNode, variant, fragments.join("\n"));
    },
    type: "multiline-element",
  };
}

const frontmatterTransformer = createRawBlockTransformer(
  "frontmatter",
  (lines, startLineIndex) =>
    matchSourceBlockTransformerEndLine(lines, startLineIndex, "frontmatter"),
);
frontmatterTransformer.regExpStart = FRONTMATTER_DELIMITER_RE;

const fencedDivTransformer = createRawBlockTransformer(
  "fenced-div",
  (lines, startLineIndex) =>
    matchSourceBlockTransformerEndLine(lines, startLineIndex, "fenced-div"),
);
fencedDivTransformer.regExpStart = FENCED_DIV_START_RE;

const displayMathDollarTransformer = createRawBlockTransformer(
  "display-math",
  (lines, startLineIndex) =>
    matchSourceBlockTransformerEndLine(lines, startLineIndex, "display-math"),
);
displayMathDollarTransformer.regExpStart = DISPLAY_MATH_DOLLAR_START_RE;

const displayMathBracketTransformer = createRawBlockTransformer(
  "display-math",
  (lines, startLineIndex) =>
    matchSourceBlockTransformerEndLine(lines, startLineIndex, "display-math"),
);
displayMathBracketTransformer.regExpStart = DISPLAY_MATH_BRACKET_BLOCK_START_RE;

const rawEquationTransformer = createRawBlockTransformer(
  "display-math",
  (lines, startLineIndex) =>
    matchSourceBlockTransformerEndLine(lines, startLineIndex, "display-math"),
);
rawEquationTransformer.regExpStart = RAW_EQUATION_START_RE;

const imageBlockTransformer = createRawBlockTransformer(
  "image",
  (lines, startLineIndex) =>
    matchSourceBlockTransformerEndLine(lines, startLineIndex, "image"),
);
imageBlockTransformer.regExpStart = IMAGE_BLOCK_START_RE;

const footnoteDefinitionTransformer = createRawBlockTransformer(
  "footnote-definition",
  (lines, startLineIndex) =>
    matchSourceBlockTransformerEndLine(lines, startLineIndex, "footnote-definition", {
      includeFootnoteTerminatingBlank: true,
    }),
);
footnoteDefinitionTransformer.regExpStart = FOOTNOTE_DEFINITION_START_RE;

const gridTableTransformer = createRawBlockTransformer(
  "grid-table",
  (lines, startLineIndex) =>
    matchSourceBlockTransformerEndLine(lines, startLineIndex, "grid-table"),
);
gridTableTransformer.regExpStart = GRID_TABLE_SEPARATOR_RE;

function createInlineMathTransformer(
  delimiter: "dollar" | "paren",
  importRegExp: RegExp,
  regExp: RegExp,
  trigger: "$" | ")",
  getEndIndex?: TextMatchTransformer["getEndIndex"],
): TextMatchTransformer {
  return {
    dependencies: [InlineMathNode],
    export(node) {
      if ($isInlineMathNode(node) && node.getDelimiter() === delimiter) {
        return node.getTextContent();
      }
      return null;
    },
    importRegExp,
    getEndIndex,
    regExp,
    replace(node) {
      if (isRevealSourceTextNode(node)) {
        return;
      }
      const mathNode = $createInlineMathNode(
        node.getTextContent(),
        delimiter,
        node.getFormat(),
      );
      node.replace(mathNode);
      return;
    },
    trigger,
    type: "text-match",
  };
}

function getDollarMathImportEndIndex(
  node: TextNode,
  match: RegExpMatchArray,
): number | false {
  const startIndex = match.index ?? 0;
  return isBackslashEscaped(node.getTextContent(), startIndex)
    ? false
    : startIndex + match[0].length;
}

const inlineMathDollarTransformer = createInlineMathTransformer(
  "dollar",
  INLINE_MATH_DOLLAR_IMPORT_RE,
  INLINE_MATH_DOLLAR_SHORTCUT_RE,
  "$",
  getDollarMathImportEndIndex,
);

const inlineMathParenTransformer = createInlineMathTransformer(
  "paren",
  INLINE_MATH_PAREN_IMPORT_RE,
  INLINE_MATH_PAREN_SHORTCUT_RE,
  ")",
);

function createInlineTokenTransformer(
  dependencies: readonly Klass<LexicalNode>[],
  exportMatch: (node: LexicalNode) => string | null,
  replaceMatch: (node: TextNode, match: RegExpMatchArray) => void,
  importRegExp: RegExp,
  regExp: RegExp,
  trigger?: string,
): TextMatchTransformer {
  return {
    dependencies: [...dependencies],
    export(node) {
      return exportMatch(node);
    },
    importRegExp,
    regExp,
    replace(node, match) {
      if (isRevealSourceTextNode(node)) {
        return;
      }
      replaceMatch(node, match);
    },
    trigger,
    type: "text-match",
  };
}

const inlineImageTransformer = createInlineTokenTransformer(
  [InlineImageNode],
  (node) => ($isInlineImageNode(node) ? node.getRaw() : null),
  (node, match) => {
    node.replace($createInlineImageNode(match[0], node.getFormat()));
  },
  MARKDOWN_IMAGE_IMPORT_RE,
  MARKDOWN_IMAGE_SHORTCUT_RE,
  ")",
);

function textOffsetWithinParent(node: LexicalNode): number | null {
  const parent = node.getParent();
  if (!parent) {
    return null;
  }

  let offset = 0;
  let sibling = node.getPreviousSibling();
  while (sibling) {
    offset += sibling.getTextContent().length;
    sibling = sibling.getPreviousSibling();
  }
  return offset;
}

function shouldReplaceReferenceMatch(node: TextNode, raw: string): boolean {
  const parent = node.getParent();
  const from = textOffsetWithinParent(node);
  if (!parent || from === null) {
    return scanReferenceRevealTokens(raw).some((token) =>
      token.from === 0 && token.to === raw.length && token.source === raw
    );
  }

  const to = from + raw.length;
  return scanReferenceRevealTokens(parent.getTextContent()).some((token) =>
    token.from === from && token.to === to && token.source === raw
  );
}

const bracketedReferenceTransformer = createInlineTokenTransformer(
  [ReferenceNode],
  (node) => ($isReferenceNode(node) ? node.getRaw() : null),
  (node, match) => {
    if (!shouldReplaceReferenceMatch(node, match[0])) {
      return;
    }
    node.replace($createReferenceNode(match[0], node.getFormat()));
  },
  BRACKETED_REFERENCE_IMPORT_RE,
  BRACKETED_REFERENCE_SHORTCUT_RE,
  "]",
);

const narrativeReferenceTransformer = createInlineTokenTransformer(
  [ReferenceNode],
  (node) => ($isReferenceNode(node) ? node.getRaw() : null),
  (node, match) => {
    if (!shouldReplaceReferenceMatch(node, match[0])) {
      return;
    }
    node.replace($createReferenceNode(match[0], node.getFormat()));
  },
  NARRATIVE_REFERENCE_IMPORT_RE,
  NARRATIVE_REFERENCE_SHORTCUT_RE,
);

const footnoteReferenceTransformer = createInlineTokenTransformer(
  [FootnoteReferenceNode],
  (node) => ($isFootnoteReferenceNode(node) ? node.getRaw() : null),
  (node, match) => {
    node.replace($createFootnoteReferenceNode(match[0], node.getFormat()));
  },
  FOOTNOTE_REFERENCE_IMPORT,
  FOOTNOTE_REFERENCE_SHORTCUT,
  "]",
);

function isTrailingHeadingTextNode(node: TextNode): boolean {
  const parent = node.getParent();
  if (!$isHeadingNode(parent)) {
    return false;
  }
  let sibling = node.getNextSibling();
  while (sibling) {
    if (sibling.getTextContent().length > 0) {
      return false;
    }
    sibling = sibling.getNextSibling();
  }
  return true;
}

const headingAttributeTransformer: TextMatchTransformer = {
  dependencies: [HeadingAttributeNode],
  export(node) {
    return $isHeadingAttributeNode(node) ? node.getRaw() : null;
  },
  importRegExp: HEADING_TRAILING_ATTRIBUTES_RE,
  regExp: HEADING_TRAILING_ATTRIBUTES_RE,
  replace(node, match) {
    if (isRevealSourceTextNode(node)) {
      return;
    }
    if (!isTrailingHeadingTextNode(node)) {
      return;
    }
    node.replace($createHeadingAttributeNode(match[0]));
  },
  trigger: "}",
  type: "text-match",
};

function isRevealSourceTextNode(node: TextNode): boolean {
  return isRevealSourceStyle(node.getStyle());
}

const tableCellMarkdownTransformers = [
  ...TEXT_FORMAT_TRANSFORMERS,
  inlineMathDollarTransformer,
  inlineMathParenTransformer,
  inlineImageTransformer,
  footnoteReferenceTransformer,
  narrativeReferenceTransformer,
  ...TEXT_MATCH_TRANSFORMERS,
  bracketedReferenceTransformer,
] satisfies readonly Transformer[];

const tableBlockTransformer = createTableBlockTransformer(
  tableCellMarkdownTransformers,
  joinRawLines,
);

function nextSiblingRequiresListSeparator(node: LexicalNode): boolean {
  const next = node.getNextSibling();
  return Boolean(
    next
    && next.getType() !== "list"
    && !(next.getType() === "paragraph" && next.getTextContent().trim() === ""),
  );
}

function withListExportSeparator(transformer: ElementTransformer): ElementTransformer {
  return {
    ...transformer,
    export(node, exportChildren) {
      const markdown = transformer.export(node, exportChildren);
      if (markdown === null || !$isListNode(node) || !nextSiblingRequiresListSeparator(node)) {
        return markdown;
      }
      return `${markdown}\n`;
    },
  };
}

const unorderedListTransformer = withListExportSeparator(UNORDERED_LIST);
const orderedListTransformer = withListExportSeparator(ORDERED_LIST);
const checkListTransformer = withListExportSeparator(CHECK_LIST);

const blockquoteImportTransformer: ElementTransformer = {
  ...QUOTE,
  export(node, traverseChildren) {
    if (!$isQuoteNode(node)) {
      return null;
    }
    const body = traverseChildren(node).replace(/\n+$/, "");
    return body.length > 0
      ? `::: {.blockquote}\n${body}\n:::`
      : "::: {.blockquote}\n:::";
  },
  replace(parentNode, children, match, isImport) {
    if (!isImport) {
      return false;
    }
    return QUOTE.replace(parentNode, children, match, isImport);
  },
};

export const createTableNodeFromMarkdown = (raw: string) =>
  createTableNodeFromMarkdownInner(raw, tableCellMarkdownTransformers);

export const coflatMarkdownTransformers = [
  frontmatterTransformer,
  fencedDivTransformer,
  rawEquationTransformer,
  displayMathDollarTransformer,
  displayMathBracketTransformer,
  imageBlockTransformer,
  gridTableTransformer,
  tableBlockTransformer,
  footnoteDefinitionTransformer,
  inlineMathDollarTransformer,
  inlineMathParenTransformer,
  inlineImageTransformer,
  footnoteReferenceTransformer,
  narrativeReferenceTransformer,
  headingAttributeTransformer,
  HEADING,
  blockquoteImportTransformer,
  unorderedListTransformer,
  orderedListTransformer,
  checkListTransformer,
  CODE,
  ...TEXT_FORMAT_TRANSFORMERS,
  ...TEXT_MATCH_TRANSFORMERS,
  bracketedReferenceTransformer,
] satisfies readonly Transformer[];

export function containsDollarInlineMathSource(text: string): boolean {
  return findNextInlineMathSource(text, 0) !== null;
}
