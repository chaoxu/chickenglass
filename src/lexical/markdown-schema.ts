import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { createHeadlessEditor } from "@lexical/headless";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import type { EditorThemeClasses, LexicalEditor } from "lexical";

import { FootnoteReferenceNode } from "./nodes/footnote-reference-node";
import { HeadingAttributeNode } from "./nodes/heading-attribute-node";
import { InlineImageNode } from "./nodes/inline-image-node";
import { InlineMathNode } from "./nodes/inline-math-node";
import { RawBlockNode } from "./nodes/raw-block-node";
import { ReferenceNode } from "./nodes/reference-node";
import { TableCellNode } from "./nodes/table-cell-node";
import { TableNode } from "./nodes/table-node";
import { TableRowNode } from "./nodes/table-row-node";
import { getInlineTextFormatSpecs } from "./runtime";

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

export function createHeadlessCoflatEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "coflat-headless-markdown",
    nodes: [...coflatMarkdownNodes],
    onError(error: Error) {
      throw error;
    },
  });
}
