import type { InitialEditorStateType } from "@lexical/react/LexicalComposer";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { createHeadlessEditor } from "@lexical/headless";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import {
  CHECK_LIST,
  type MultilineElementTransformer,
  type TextMatchTransformer,
  type Transformer,
  TEXT_FORMAT_TRANSFORMERS,
  TEXT_MATCH_TRANSFORMERS,
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  type EditorUpdateOptions,
  type EditorThemeClasses,
  type ElementNode,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type TextNode,
} from "lexical";

import { getInlineTextFormatSpecs } from "../lexical-next";
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

const FRONTMATTER_DELIMITER = /^---\s*$/;
const FENCED_DIV_START = /^\s*(:{3,})(.*)$/;
const DISPLAY_MATH_DOLLAR_START = /^\s*\$\$(?!\$).*$/;
const DISPLAY_MATH_BRACKET_START = /^\s*\\\[\s*$/;
const DISPLAY_MATH_DOLLAR_END = /^\s*\$\$(?:\s+\{#[^}]+\})?\s*$/;
const DISPLAY_MATH_BRACKET_END = /^\s*\\\](?:\s+\{#[^}]+\})?\s*$/;
const INLINE_MATH_DOLLAR_IMPORT = /\$(?:[^$\n\\]|\\.)+\$/;
const INLINE_MATH_DOLLAR_SHORTCUT = /\$(?:[^$\n\\]|\\.)+\$$/;
const INLINE_MATH_PAREN_IMPORT = /\\\((?:[^\\\n]|\\.)+\\\)/;
const INLINE_MATH_PAREN_SHORTCUT = /\\\((?:[^\\\n]|\\.)+\\\)$/;
const INLINE_IMAGE_IMPORT = /!\[[^\]\n]*\]\([^)]+\)/;
const INLINE_IMAGE_SHORTCUT = /!\[[^\]\n]*\]\([^)]+\)$/;
const BRACKETED_REFERENCE_IMPORT = /\[(?:[^\]\n\\]|\\.)*?@[^\]\n]*\]/;
const BRACKETED_REFERENCE_SHORTCUT = /\[(?:[^\]\n\\]|\\.)*?@[^\]\n]*\]$/;
const NARRATIVE_REFERENCE_IMPORT = /@([A-Za-z0-9_](?:[\w.:-]*\w)?)/;
const NARRATIVE_REFERENCE_SHORTCUT = /@([A-Za-z0-9_](?:[\w.:-]*\w)?)$/;
const FOOTNOTE_REFERENCE_IMPORT = /\[\^[^\]\n]+\]/;
const FOOTNOTE_REFERENCE_SHORTCUT = /\[\^[^\]\n]+\]$/;
const IMAGE_BLOCK_START = /^\s*!\[[^\]\n]*\]\([^)]+\)\s*$/;
const FOOTNOTE_DEFINITION_START = /^\[\^[^\]]+\]:\s*(.*)$/;

function joinRawLines(lines: readonly string[], startLineIndex: number, endLineIndex: number): string {
  return lines.slice(startLineIndex, endLineIndex + 1).join("\n");
}

function appendRawBlock(rootNode: ElementNode, variant: RawBlockVariant, raw: string): boolean {
  rootNode.append($createRawBlockNode(variant, raw));
  return true;
}

function matchDisplayMathEnd(
  lines: readonly string[],
  startLineIndex: number,
  endRegExp: RegExp,
): number {
  const startLine = lines[startLineIndex];
  if (DISPLAY_MATH_DOLLAR_START.test(startLine)) {
    const sameLineEnd = startLine.indexOf("$$", startLine.indexOf("$$") + 2);
    if (sameLineEnd !== -1) {
      return startLineIndex;
    }
  }

  for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    if (endRegExp.test(lines[lineIndex])) {
      return lineIndex;
    }
  }

  return -1;
}

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
  (lines, startLineIndex) => {
    if (startLineIndex !== 0 || !FRONTMATTER_DELIMITER.test(lines[startLineIndex])) {
      return -1;
    }
    for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      if (FRONTMATTER_DELIMITER.test(lines[lineIndex])) {
        return lineIndex;
      }
    }
    return -1;
  },
);
frontmatterTransformer.regExpStart = FRONTMATTER_DELIMITER;

const fencedDivTransformer = createRawBlockTransformer(
  "fenced-div",
  (lines, startLineIndex, startMatch) => {
    const colonCount = startMatch[1]?.length ?? 0;
    if (colonCount < 3) {
      return -1;
    }
    const closingFence = new RegExp(`^\\s*:{${colonCount}}\\s*$`);
    for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      if (closingFence.test(lines[lineIndex])) {
        return lineIndex;
      }
    }
    return -1;
  },
);
fencedDivTransformer.regExpStart = FENCED_DIV_START;

const displayMathDollarTransformer = createRawBlockTransformer(
  "display-math",
  (lines, startLineIndex) => {
    if (!DISPLAY_MATH_DOLLAR_START.test(lines[startLineIndex])) {
      return -1;
    }
    return matchDisplayMathEnd(lines, startLineIndex, DISPLAY_MATH_DOLLAR_END);
  },
);
displayMathDollarTransformer.regExpStart = DISPLAY_MATH_DOLLAR_START;

const displayMathBracketTransformer = createRawBlockTransformer(
  "display-math",
  (lines, startLineIndex) => {
    if (!DISPLAY_MATH_BRACKET_START.test(lines[startLineIndex])) {
      return -1;
    }
    return matchDisplayMathEnd(lines, startLineIndex, DISPLAY_MATH_BRACKET_END);
  },
);
displayMathBracketTransformer.regExpStart = DISPLAY_MATH_BRACKET_START;

const imageBlockTransformer = createRawBlockTransformer(
  "image",
  (lines, startLineIndex) =>
    IMAGE_BLOCK_START.test(lines[startLineIndex] ?? "")
      ? startLineIndex
      : -1,
);
imageBlockTransformer.regExpStart = IMAGE_BLOCK_START;

const footnoteDefinitionTransformer = createRawBlockTransformer(
  "footnote-definition",
  (lines, startLineIndex) => {
    if (!FOOTNOTE_DEFINITION_START.test(lines[startLineIndex] ?? "")) {
      return -1;
    }
    let endLineIndex = startLineIndex;
    for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] ?? "";
      if (/^\s*$/.test(line)) {
        endLineIndex = lineIndex;
        break;
      }
      if (!/^\s{2,4}\S/.test(line)) {
        break;
      }
      endLineIndex = lineIndex;
    }
    return endLineIndex;
  },
);
footnoteDefinitionTransformer.regExpStart = FOOTNOTE_DEFINITION_START;

function createInlineMathTransformer(
  delimiter: "dollar" | "paren",
  importRegExp: RegExp,
  regExp: RegExp,
  trigger: "$" | ")",
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
    regExp,
    replace(node) {
      const mathNode = $createInlineMathNode(node.getTextContent(), delimiter);
      node.replace(mathNode);
      return;
    },
    trigger,
    type: "text-match",
  };
}

const inlineMathDollarTransformer = createInlineMathTransformer(
  "dollar",
  INLINE_MATH_DOLLAR_IMPORT,
  INLINE_MATH_DOLLAR_SHORTCUT,
  "$",
);

const inlineMathParenTransformer = createInlineMathTransformer(
  "paren",
  INLINE_MATH_PAREN_IMPORT,
  INLINE_MATH_PAREN_SHORTCUT,
  ")",
);

const inlineImageTransformer = createInlineTokenTransformer(
  [InlineImageNode],
  (node) => ($isInlineImageNode(node) ? node.getRaw() : null),
  (node, match) => {
    node.replace($createInlineImageNode(match[0]));
  },
  INLINE_IMAGE_IMPORT,
  INLINE_IMAGE_SHORTCUT,
);

function createInlineTokenTransformer(
  dependencies: readonly Klass<LexicalNode>[],
  exportMatch: (node: LexicalNode) => string | null,
  replaceMatch: (node: TextNode, match: RegExpMatchArray) => void,
  importRegExp: RegExp,
  regExp: RegExp,
): TextMatchTransformer {
  return {
    dependencies: [...dependencies],
    export(node) {
      return exportMatch(node);
    },
    importRegExp,
    regExp,
    replace(node, match) {
      replaceMatch(node, match);
    },
    type: "text-match",
  };
}

const bracketedReferenceTransformer = createInlineTokenTransformer(
  [ReferenceNode],
  (node) => ($isReferenceNode(node) ? node.getRaw() : null),
  (node, match) => {
    node.replace($createReferenceNode(match[0]));
  },
  BRACKETED_REFERENCE_IMPORT,
  BRACKETED_REFERENCE_SHORTCUT,
);

const narrativeReferenceTransformer = createInlineTokenTransformer(
  [ReferenceNode],
  (node) => ($isReferenceNode(node) ? node.getRaw() : null),
  (node, match) => {
    node.replace($createReferenceNode(match[0]));
  },
  NARRATIVE_REFERENCE_IMPORT,
  NARRATIVE_REFERENCE_SHORTCUT,
);

const footnoteReferenceTransformer = createInlineTokenTransformer(
  [FootnoteReferenceNode],
  (node) => ($isFootnoteReferenceNode(node) ? node.getRaw() : null),
  (node, match) => {
    node.replace($createFootnoteReferenceNode(match[0]));
  },
  FOOTNOTE_REFERENCE_IMPORT,
  FOOTNOTE_REFERENCE_SHORTCUT,
);

const tableCellMarkdownTransformers = [
  ...TEXT_FORMAT_TRANSFORMERS,
  inlineMathDollarTransformer,
  inlineMathParenTransformer,
  inlineImageTransformer,
  bracketedReferenceTransformer,
  footnoteReferenceTransformer,
  narrativeReferenceTransformer,
  ...TEXT_MATCH_TRANSFORMERS,
] satisfies readonly Transformer[];

const tableBlockTransformer = createTableBlockTransformer(
  tableCellMarkdownTransformers,
  joinRawLines,
);

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
  displayMathDollarTransformer,
  displayMathBracketTransformer,
  imageBlockTransformer,
  tableBlockTransformer,
  footnoteDefinitionTransformer,
  inlineMathDollarTransformer,
  inlineMathParenTransformer,
  inlineImageTransformer,
  bracketedReferenceTransformer,
  footnoteReferenceTransformer,
  narrativeReferenceTransformer,
  ...TRANSFORMERS,
  CHECK_LIST,
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
  options?: Pick<EditorUpdateOptions, "tag">,
): void {
  editor.update(() => {
    $convertFromMarkdownString(markdown, coflatMarkdownTransformers, undefined, true);
  }, {
    discrete: true,
    tag: options?.tag,
  });
}

export function getLexicalMarkdown(editor: LexicalEditor): string {
  return editor.getEditorState().read(() =>
    $convertToMarkdownString(coflatMarkdownTransformers, undefined, true)
  );
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

