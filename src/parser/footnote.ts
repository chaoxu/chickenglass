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
import { isClosingFenceLine } from "./fenced-div";

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
 * Scan for a footnote-definition prefix `[^id]:` starting at `start` in `text`.
 * Returns the position of `]` if found, or -1 if the prefix is not present.
 */
function scanFootnoteDefPrefix(text: string, start: number): number {
  if (
    text.charCodeAt(start) !== OPEN_BRACKET ||
    text.charCodeAt(start + 1) !== CARET
  ) {
    return -1;
  }
  let i = start + 2;
  while (i < text.length) {
    const ch = text.charCodeAt(i);
    if (ch === SPACE || ch === NEWLINE || ch === CR || ch === TAB) return -1;
    if (ch === CLOSE_BRACKET) {
      return i + 1 < text.length && text.charCodeAt(i + 1) === COLON ? i : -1;
    }
    i++;
  }
  return -1;
}

function isFootnoteContinuationLine(text: string): boolean {
  if (isClosingFenceLine(text) >= 3) return false;

  let indent = 0;
  let pos = 0;
  while (pos < text.length) {
    const ch = text.charCodeAt(pos);
    if (ch === SPACE) {
      indent++;
    } else if (ch === TAB) {
      indent += 4 - (indent % 4);
    } else {
      break;
    }
    pos++;
  }

  return indent >= 2 && indent <= 4 && pos < text.length;
}

/**
 * Block parser for [^id]: content footnote definitions.
 * Produces FootnoteDef nodes spanning the definition and continuation lines.
 */
const footnoteDefParser: BlockParser = {
  name: "FootnoteDef",
  // Allow footnote definitions to interrupt paragraphs, matching Pandoc
  // behavior where [^id]: at the start of a line ends the current paragraph.
  endLeaf(_cx: BlockContext, line: Line): boolean {
    return scanFootnoteDefPrefix(line.text, line.pos) >= 0;
  },
  parse(cx: BlockContext, line: Line) {
    const text = line.text;
    const start = line.pos;
    const bracketPos = scanFootnoteDefPrefix(text, start);
    if (bracketPos < 0) return false;

    // Found [^id]:
    const absFrom = cx.lineStart + start;
    const labelFrom = cx.lineStart + start;
    const labelTo = cx.lineStart + bracketPos + 2; // includes ]:

    const labelEl = cx.elt("FootnoteDefLabel", labelFrom, labelTo);

    // Parse inline content (math, bold, italic, etc.) in the body text
    // after the label, so CM6 inline render plugins handle footnote
    // content naturally without a separate re-rendering widget (#430).
    const bodyStart = bracketPos + 2; // position after ]:
    const bodyAbsFrom = cx.lineStart + bodyStart;
    const bodyParts = [text.slice(bodyStart)];
    let absTo = cx.lineStart + text.length;

    while (isFootnoteContinuationLine(cx.peekLine())) {
      if (!cx.nextLine()) break;
      bodyParts.push(`\n${line.text}`);
      absTo = cx.lineStart + line.text.length;
    }

    const bodyText = bodyParts.join("");
    const inlineChildren = bodyText.length > 0
      ? cx.parser.parseInline(bodyText, bodyAbsFrom)
      : [];

    cx.addElement(cx.elt("FootnoteDef", absFrom, absTo, [labelEl, ...inlineChildren]));
    cx.nextLine();
    return true;
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
