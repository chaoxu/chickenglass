import type { InitialEditorStateType } from "@lexical/react/LexicalComposer";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { createHeadlessEditor } from "@lexical/headless";
import { LinkNode } from "@lexical/link";
import { $isListNode, ListItemNode, ListNode } from "@lexical/list";
import {
  CHECK_LIST,
  CODE,
  HEADING,
  ORDERED_LIST,
  QUOTE,
  UNORDERED_LIST,
  type ElementTransformer,
  type MultilineElementTransformer,
  type TextMatchTransformer,
  type Transformer,
  TEXT_FORMAT_TRANSFORMERS,
  TEXT_MATCH_TRANSFORMERS,
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import { $isHeadingNode, $isQuoteNode, HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  type EditorUpdateOptions,
  type EditorThemeClasses,
  type ElementNode,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type SerializedEditorState,
  type TextNode,
} from "lexical";

import { HEADING_TRAILING_ATTRIBUTES_RE } from "../lib/markdown/heading-syntax";
import { measureSync } from "../lib/perf";
import {
  findNextInlineMathSource,
  INLINE_MATH_DOLLAR_IMPORT_RE,
  INLINE_MATH_DOLLAR_SHORTCUT_RE,
  INLINE_MATH_PAREN_IMPORT_RE,
  INLINE_MATH_PAREN_SHORTCUT_RE,
} from "../lib/inline-math-source";
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
import { getInlineTextFormatSpecs } from "./runtime";
import {
  $createInlineImageNode,
  $isInlineImageNode,
  InlineImageNode,
} from "./nodes/inline-image-node";
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
import { $createInlineMathNode, $isInlineMathNode, InlineMathNode } from "./nodes/inline-math-node";
import { $createReferenceNode, $isReferenceNode, ReferenceNode } from "./nodes/reference-node";
import { $createRawBlockNode, $isRawBlockNode, type RawBlockVariant, RawBlockNode } from "./nodes/raw-block-node";
import { TableCellNode } from "./nodes/table-cell-node";
import { TableNode } from "./nodes/table-node";
import { TableRowNode } from "./nodes/table-row-node";
import {
  createTableBlockTransformer,
  createTableNodeFromMarkdown as createTableNodeFromMarkdownInner,
} from "./markdown/table-lexical";
import {
  DISPLAY_MATH_BRACKET_BLOCK_START_RE,
  DISPLAY_MATH_DOLLAR_START_RE,
  FENCED_DIV_START_RE,
  FOOTNOTE_DEFINITION_START_RE,
  FRONTMATTER_DELIMITER_RE,
  GRID_TABLE_SEPARATOR_RE,
  IMAGE_BLOCK_START_RE,
  RAW_EQUATION_START_RE,
  computeSourceLineOffsets,
  matchSourceBlockRangeAtLine,
  type CollectSourceBlockRangesOptions,
  type SourceBlockVariant,
} from "./markdown/block-scanner";
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

// Suppress live markdown-shortcut conversion for raw-block multiline
// transformers. With a required regExpEnd set, @lexical/markdown's
// runMultilineElementTransformers skips the transformer, leaving typing as
// plain text. Import still works because handleImportAfterStartMatch runs
// before the end-regex is consulted. MarkdownExpansionPlugin owns the
// on-Enter conversion for these variants.
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

export const coflatMarkdownNodes = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  CodeNode,
  CodeHighlightNode,
  InlineMathNode,
  InlineImageNode,
  ReferenceNode,
  FootnoteReferenceNode,
  HeadingAttributeNode,
  RawBlockNode,
  TableNode,
  TableRowNode,
  TableCellNode,
] as const;

const codeHighlightTokens = [
  "atrule",
  "attr",
  "boolean",
  "builtin",
  "cdata",
  "char",
  "class-name",
  "comment",
  "constant",
  "deleted",
  "doctype",
  "entity",
  "function",
  "important",
  "inserted",
  "keyword",
  "namespace",
  "number",
  "operator",
  "prolog",
  "property",
  "punctuation",
  "regex",
  "selector",
  "string",
  "symbol",
  "tag",
  "url",
  "variable",
] as const;

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
];

export const lexicalMarkdownTheme: EditorThemeClasses = {
  root: "cf-lexical-root",
  paragraph: "cf-lexical-paragraph",
  quote: "cf-lexical-quote",
  heading: {
    h1: "cf-lexical-heading cf-lexical-heading--h1",
    h2: "cf-lexical-heading cf-lexical-heading--h2",
    h3: "cf-lexical-heading cf-lexical-heading--h3",
    h4: "cf-lexical-heading cf-lexical-heading--h4",
    h5: "cf-lexical-heading cf-lexical-heading--h5",
    h6: "cf-lexical-heading cf-lexical-heading--h6",
  },
  list: {
    checklist: "cf-lexical-list cf-lexical-list--check",
    listitem: "cf-lexical-list-item",
    listitemChecked: "cf-lexical-list-item cf-lexical-list-item--checked",
    listitemUnchecked: "cf-lexical-list-item cf-lexical-list-item--unchecked",
    nested: {
      listitem: "cf-lexical-list-item--nested",
    },
    ol: "cf-lexical-list cf-lexical-list--ordered",
    ul: "cf-lexical-list cf-lexical-list--unordered",
  },
  link: "cf-lexical-link",
  code: "cf-lexical-code-block block",
  codeHighlight: Object.fromEntries(
    codeHighlightTokens.map((token) => [
      token,
      `cf-lexical-code-token cf-lexical-code-token--${token}`,
    ]),
  ) as NonNullable<EditorThemeClasses["codeHighlight"]>,
  text: Object.fromEntries(
    getInlineTextFormatSpecs().map((spec) => [spec.lexicalFormat, spec.themeClassName]),
  ) as NonNullable<EditorThemeClasses["text"]>,
};

export function createLexicalInitialEditorState(markdown: string): InitialEditorStateType {
  return () => {
    $convertFromMarkdownString(markdown, coflatMarkdownTransformers, undefined, true);
  };
}

export function setLexicalMarkdown(
  editor: LexicalEditor,
  markdown: string,
  options?: {
    readonly discrete?: boolean;
    readonly tag?: EditorUpdateOptions["tag"];
  },
): void {
  measureSync("lexical.setLexicalMarkdown", () => {
    const updateOptions: EditorUpdateOptions = {
      tag: options?.tag,
    };
    if (options?.discrete ?? true) {
      updateOptions.discrete = true;
    }
    editor.update(() => {
      $convertFromMarkdownString(markdown, coflatMarkdownTransformers, undefined, true);
    }, updateOptions);
  }, { category: "lexical", detail: `${markdown.length} chars` });
}

const FORMATTED_INLINE_SOURCE_NODE_TYPES = new Set([
  "coflat-footnote-reference",
  "coflat-inline-image",
  "coflat-inline-math",
  "coflat-reference",
]);

interface SerializedNodeRecord {
  readonly children?: unknown;
  readonly format?: unknown;
  readonly raw?: unknown;
  readonly text?: unknown;
  readonly type?: unknown;
  readonly [key: string]: unknown;
}

function isSerializedNodeRecord(value: unknown): value is SerializedNodeRecord {
  return typeof value === "object" && value !== null;
}

function sourceReplacementPlaceholder(index: number): string {
  return `\uE000coflat-source-${index}\uE001`;
}

function replaceLiteralDollarMathText(
  text: string,
  replacements: string[],
): {
  readonly changed: boolean;
  readonly text: string;
} {
  let cursor = 0;
  let next = "";
  let changed = false;

  for (;;) {
    const parsed = findNextInlineMathSource(text, cursor);
    if (!parsed) break;

    next += text.slice(cursor, parsed.from);
    const placeholder = sourceReplacementPlaceholder(replacements.length);
    replacements.push(`\\${parsed.raw}`);
    next += placeholder;
    cursor = parsed.to;
    changed = true;
  }

  return changed
    ? { changed, text: next + text.slice(cursor) }
    : { changed, text };
}

function transformFormattedInlineSourceNodes(
  node: unknown,
  replacements: string[] = [],
): {
  readonly changed: boolean;
  readonly node: unknown;
} {
  if (!isSerializedNodeRecord(node)) {
    return { changed: false, node };
  }

  if (node.type === "text" && typeof node.text === "string") {
    const escaped = replaceLiteralDollarMathText(node.text, replacements);
    return escaped.changed
      ? {
          changed: true,
          node: {
            ...node,
            text: escaped.text,
          },
        }
      : { changed: false, node };
  }

  if (
    typeof node.type === "string"
    && FORMATTED_INLINE_SOURCE_NODE_TYPES.has(node.type)
    && typeof node.raw === "string"
    && typeof node.format === "number"
    && node.format !== 0
  ) {
    const placeholder = sourceReplacementPlaceholder(replacements.length);
    replacements.push(node.raw);
    return {
      changed: true,
      node: {
        detail: 0,
        format: node.format,
        mode: "normal",
        style: "",
        text: placeholder,
        type: "text",
        version: 1,
      },
    };
  }

  if (!Array.isArray(node.children)) {
    return { changed: false, node };
  }

  let changed = false;
  const children = node.children.map((child) => {
    const result = transformFormattedInlineSourceNodes(child, replacements);
    changed ||= result.changed;
    return result.node;
  });

  if (!changed) {
    return { changed: false, node };
  }

  return {
    changed: true,
    node: {
      ...node,
      children,
    },
  };
}

export function exportMarkdownFromSerializedState(
  state: SerializedEditorState,
  sourceReplacements: readonly string[] = [],
): string {
  const exportEditor = createHeadlessCoflatEditor();
  exportEditor.setEditorState(exportEditor.parseEditorState(JSON.stringify(state)));
  const markdown = exportEditor.getEditorState().read(() =>
    $convertToMarkdownString(coflatMarkdownTransformers, undefined, true)
  );
  return sourceReplacements.reduce(
    (current, source, index) =>
      current.replaceAll(sourceReplacementPlaceholder(index), source),
    markdown,
  );
}

export function getLexicalMarkdown(editor: LexicalEditor): string {
  return measureSync("lexical.getLexicalMarkdown", () => {
    const editorState = editor.getEditorState();
    const serialized = editorState.toJSON();
    const sourceReplacements: string[] = [];
    const transformedRoot = transformFormattedInlineSourceNodes(
      serialized.root,
      sourceReplacements,
    );
    if (transformedRoot.changed) {
      return exportMarkdownFromSerializedState({
        root: transformedRoot.node as SerializedEditorState["root"],
      }, sourceReplacements);
    }
    return editorState.read(() =>
      $convertToMarkdownString(coflatMarkdownTransformers, undefined, true)
    );
  }, { category: "lexical" });
}

export function createHeadlessCoflatEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "coflat-headless-markdown",
    nodes: [...coflatMarkdownNodes],
    onError(error: Error) {
      throw error;
    },
  });
}

export function roundTripMarkdown(markdown: string): string {
  const editor = createHeadlessCoflatEditor();
  setLexicalMarkdown(editor, markdown);
  return getLexicalMarkdown(editor);
}
