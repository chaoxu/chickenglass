import type {
  BlockContext,
  BlockParser,
  Line,
  MarkdownConfig,
  NodeSpec,
} from "@lezer/markdown";

/**
 * Lezer markdown extension for Pandoc-style fenced divs.
 *
 * Syntax:
 *   ::: {.class #id key=val} Optional Title
 *   Content parsed as full markdown.
 *   :::
 *
 * Nesting uses more colons on the outer fence:
 *   :::: {.outer}
 *   ::: {.inner}
 *   :::
 *   ::::
 *
 * The composite block API causes content inside the fences to be
 * parsed as regular markdown automatically.
 */

// Character code for ':'
const COLON = 58;

/** Count consecutive colons starting at `pos` in `text`. */
function countColons(text: string, pos: number): number {
  let count = 0;
  while (pos + count < text.length && text.charCodeAt(pos + count) === COLON) {
    count++;
  }
  return count;
}

/** Find the end of the attribute block `{...}` starting at `pos`. Returns -1 if not found. */
function findAttrEnd(text: string, pos: number): number {
  if (pos >= text.length || text.charCodeAt(pos) !== 123 /* '{' */) return -1;
  let depth = 1;
  let i = pos + 1;
  while (i < text.length && depth > 0) {
    const ch = text.charCodeAt(i);
    if (ch === 123 /* '{' */) depth++;
    else if (ch === 125 /* '}' */) depth--;
    i++;
  }
  return depth === 0 ? i : -1;
}

/** Skip whitespace characters (space and tab) starting at `pos`. */
function skipWhitespace(text: string, pos: number): number {
  while (
    pos < text.length &&
    (text.charCodeAt(pos) === 32 || text.charCodeAt(pos) === 9)
  ) {
    pos++;
  }
  return pos;
}

/**
 * Check if a line is a closing fence (3+ colons followed by only whitespace).
 * Returns the colon count or -1 if not a closing fence.
 */
function isClosingFence(text: string, pos: number): number {
  const colonCount = countColons(text, pos);
  if (colonCount < 3) return -1;
  const afterColons = skipWhitespace(text, pos + colonCount);
  return afterColons >= text.length ? colonCount : -1;
}

/**
 * Parse an opening fence line. Returns fence info or undefined.
 * Opening fence: 3+ colons, optional attributes `{...}`, optional title.
 */
function parseOpeningFence(
  text: string,
  pos: number,
): OpeningFenceInfo | undefined {
  const colonCount = countColons(text, pos);
  if (colonCount < 3) return undefined;

  let cursor = skipWhitespace(text, pos + colonCount);

  // Must have at least attributes or be followed by non-whitespace
  // A bare `:::` with nothing after is a closing fence, not an opening one
  if (cursor >= text.length) return undefined;

  let attrFrom = -1;
  let attrTo = -1;

  // Check for attribute block
  if (text.charCodeAt(cursor) === 123 /* '{' */) {
    const end = findAttrEnd(text, cursor);
    if (end === -1) return undefined;
    attrFrom = cursor;
    attrTo = end;
    cursor = skipWhitespace(text, end);
  } else {
    // Short-form: ::: ClassName [Title...]
    // The first word is treated as the class name. We synthesize a
    // FencedDivAttributes node whose text is the bare class name
    // (no braces). extractDivClass() in fenced-div-attrs.ts handles
    // both braced and bare forms.
    const wordStart = cursor;
    while (
      cursor < text.length &&
      text.charCodeAt(cursor) !== 32 &&
      text.charCodeAt(cursor) !== 9
    ) {
      cursor++;
    }
    if (cursor === wordStart) return undefined; // nothing after :::
    attrFrom = wordStart;
    attrTo = cursor;
    cursor = skipWhitespace(text, cursor);
  }

  // Remaining text is the title (may be empty)
  const titleFrom = cursor;
  // Trim trailing whitespace from title
  let titleTo = text.length;
  while (
    titleTo > titleFrom &&
    (text.charCodeAt(titleTo - 1) === 32 || text.charCodeAt(titleTo - 1) === 9)
  ) {
    titleTo--;
  }

  return {
    colonCount,
    attrFrom,
    attrTo,
    titleFrom,
    titleTo,
  };
}

interface OpeningFenceInfo {
  readonly colonCount: number;
  readonly attrFrom: number;
  readonly attrTo: number;
  readonly titleFrom: number;
  readonly titleTo: number;
}

/**
 * Composite callback for FencedDiv. Called on each new line to decide
 * if the block continues. Returns `true` to continue, `false` to end.
 *
 * The `value` parameter stores the opening fence's colon count.
 */
function fencedDivComposite(
  cx: BlockContext,
  line: Line,
  value: number,
): boolean {
  const closingColons = isClosingFence(line.text, line.pos);
  if (closingColons >= value) {
    // Closing fence found -- add a marker for it and end the composite
    line.addMarker(
      cx.elt(
        "FencedDivFence",
        cx.lineStart + line.pos,
        cx.lineStart + line.pos + closingColons,
      ),
    );
    return false;
  }
  return true;
}

const fencedDivBlockParser: BlockParser = {
  name: "FencedDiv",
  // Place before FencedCode so ::: is recognized before ``` logic
  before: "FencedCode",

  parse(cx: BlockContext, line: Line) {
    // Check for closing fence that was rejected by composite callback.
    // After the composite finishes, the closing fence line is re-processed
    // by block parsers. We consume it here so it doesn't become a paragraph.
    const closingColons = isClosingFence(line.text, line.pos);
    if (closingColons >= 3) {
      cx.nextLine();
      return true;
    }

    // Check for opening fence
    const info = parseOpeningFence(line.text, line.pos);
    if (!info) return false;

    const fenceStart = cx.lineStart + line.pos;
    const fenceEnd = cx.lineStart + line.pos + info.colonCount;

    // Start the composite block first, so child elements are added
    // inside the FencedDiv. The `value` stores the colon count so the
    // composite callback knows how many colons close this div.
    cx.startComposite("FencedDiv", line.pos, info.colonCount);

    cx.addElement(cx.elt("FencedDivFence", fenceStart, fenceEnd));

    if (info.attrFrom >= 0) {
      cx.addElement(
        cx.elt(
          "FencedDivAttributes",
          cx.lineStart + info.attrFrom,
          cx.lineStart + info.attrTo,
        ),
      );
    }

    if (info.titleFrom < info.titleTo) {
      cx.addElement(
        cx.elt(
          "FencedDivTitle",
          cx.lineStart + info.titleFrom,
          cx.lineStart + info.titleTo,
        ),
      );
    }

    // Move the line's base past the entire opening fence so the block
    // parser loop doesn't re-process this line.
    line.moveBase(line.text.length);
    return null;
  },

  endLeaf(_cx: BlockContext, line: Line) {
    // Both opening and closing fences should interrupt paragraphs
    if (isClosingFence(line.text, line.pos) >= 3) return true;
    return parseOpeningFence(line.text, line.pos) !== undefined;
  },
};

const fencedDivNodeSpec: NodeSpec = {
  name: "FencedDiv",
  block: true,
  composite: fencedDivComposite,
};

/** Markdown extension that adds fenced div parsing. */
export const fencedDiv: MarkdownConfig = {
  defineNodes: [
    fencedDivNodeSpec,
    { name: "FencedDivFence", block: true },
    { name: "FencedDivAttributes", block: true },
    { name: "FencedDivTitle", block: true },
  ],
  parseBlock: [fencedDivBlockParser],
};
