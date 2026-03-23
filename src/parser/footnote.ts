import { tags } from "@lezer/highlight";
import type {
  BlockParser,
  InlineParser,
  MarkdownConfig,
  BlockContext,
  Line,
  InlineContext,
} from "@lezer/markdown";
import { OPEN_BRACKET, CARET, CLOSE_BRACKET, COLON, SPACE, NEWLINE, CR, TAB } from "./char-utils";

/**
 * Inline parser for [^id] footnote references.
 * Produces FootnoteRef nodes containing the full [^id] text.
 */
const footnoteRefParser: InlineParser = {
  name: "FootnoteRef",
  parse(cx: InlineContext, next: number, pos: number): number {
    if (next !== OPEN_BRACKET) return -1;
    if (cx.char(pos + 1) !== CARET) return -1;

    // Scan forward for closing ]
    let i = pos + 2;
    // Must have at least one character for the id
    if (i >= cx.end || cx.char(i) === CLOSE_BRACKET) return -1;

    while (i < cx.end) {
      const ch = cx.char(i);
      // Footnote ids cannot contain spaces or newlines
      if (ch === SPACE || ch === NEWLINE || ch === CR || ch === TAB) return -1;
      if (ch === CLOSE_BRACKET) {
        // Don't match [^id]: at line start — that's a definition
        if (i + 1 < cx.end && cx.char(i + 1) === COLON) return -1;
        return cx.addElement(cx.elt("FootnoteRef", pos, i + 1));
      }
      i++;
    }

    return -1;
  },
  before: "Escape",
};

/**
 * Block parser for [^id]: content footnote definitions.
 * Produces FootnoteDef nodes spanning the definition line.
 */
const footnoteDefParser: BlockParser = {
  name: "FootnoteDef",
  // Allow footnote definitions to interrupt paragraphs, matching Pandoc
  // behavior where [^id]: at the start of a line ends the current paragraph.
  endLeaf(_cx: BlockContext, line: Line): boolean {
    const text = line.text;
    const start = line.pos;
    if (
      text.charCodeAt(start) !== OPEN_BRACKET ||
      text.charCodeAt(start + 1) !== CARET
    ) {
      return false;
    }
    let i = start + 2;
    while (i < text.length) {
      const ch = text.charCodeAt(i);
      if (ch === SPACE || ch === NEWLINE || ch === CR || ch === TAB) return false;
      if (ch === CLOSE_BRACKET) {
        return i + 1 < text.length && text.charCodeAt(i + 1) === COLON;
      }
      i++;
    }
    return false;
  },
  parse(cx: BlockContext, line: Line) {
    const text = line.text;
    const start = line.pos;

    // Must start with [^
    if (
      text.charCodeAt(start) !== OPEN_BRACKET ||
      text.charCodeAt(start + 1) !== CARET
    ) {
      return false;
    }

    // Find the closing ] followed by :
    let i = start + 2;
    while (i < text.length) {
      const ch = text.charCodeAt(i);
      if (ch === SPACE || ch === NEWLINE || ch === CR || ch === TAB) return false;
      if (ch === CLOSE_BRACKET) {
        if (i + 1 < text.length && text.charCodeAt(i + 1) === COLON) {
          // Found [^id]:
          const absFrom = cx.lineStart + start;
          const absTo = cx.lineStart + text.length;
          const labelFrom = cx.lineStart + start;
          const labelTo = cx.lineStart + i + 2; // includes ]:

          const labelEl = cx.elt("FootnoteDefLabel", labelFrom, labelTo);
          cx.addElement(cx.elt("FootnoteDef", absFrom, absTo, [labelEl]));
          cx.nextLine();
          return true;
        }
        return false;
      }
      i++;
    }

    return false;
  },
  before: "HorizontalRule",
};

/** Markdown extension that adds footnote reference and definition parsing. */
export const footnoteExtension: MarkdownConfig = {
  defineNodes: [
    {
      name: "FootnoteRef",
      style: tags.link,
    },
    {
      name: "FootnoteDef",
      block: true,
    },
    {
      name: "FootnoteDefLabel",
      style: tags.labelName,
    },
  ],
  parseInline: [footnoteRefParser],
  parseBlock: [footnoteDefParser],
};
