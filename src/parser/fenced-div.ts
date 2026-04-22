import type {
  BlockContext,
  BlockParser,
  Line,
  MarkdownConfig,
  NodeSpec,
} from "@lezer/markdown";
import { tags, styleTags } from "@lezer/highlight";
import { COLON, OPEN_BRACE, findMatchingBrace, isSpaceTab, skipSpaceTab } from "./char-utils";

/**
 * Lezer markdown extension for Pandoc-style fenced divs.
 *
 * Syntax:
 *   ::: {.class #id key=val title="Optional Title"}
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

/**
 * Toggle fenced div parser logging from the browser console:
 *   window.__fencedDivDebug = true   // enable
 *   window.__fencedDivDebug = false  // disable
 */
function fencedDivLog(msg: string): void {
  if (typeof window !== "undefined" && window.__fencedDivDebug) {
    console.log(`[fencedDiv] ${msg}`);
  }
}

/** Count consecutive colons starting at `pos` in `text`. */
export function countColons(text: string, pos: number): number {
  let count = 0;
  while (pos + count < text.length && text.charCodeAt(pos + count) === COLON) {
    count++;
  }
  return count;
}

interface FencePrefixInfo {
  readonly colonCount: number;
  readonly cursorAfterColons: number;
}

function readFencePrefix(text: string, pos: number): FencePrefixInfo | undefined {
  const colonCount = countColons(text, pos);
  if (colonCount < 3) return undefined;

  let cursor = pos + colonCount;
  while (cursor < text.length && isSpaceTab(text.charCodeAt(cursor))) {
    cursor++;
  }

  return {
    colonCount,
    cursorAfterColons: cursor,
  };
}

function closingFenceColonCount(
  text: string,
  prefix: FencePrefixInfo | undefined,
): number {
  if (!prefix) return -1;
  return prefix.cursorAfterColons >= text.length ? prefix.colonCount : -1;
}

/**
 * Check if a line is a closing fence (3+ colons followed by only whitespace).
 * Returns the colon count or -1 if not a closing fence.
 */
export function isClosingFence(text: string, pos: number): number {
  return closingFenceColonCount(text, readFencePrefix(text, pos));
}

/** Check a raw line of source for a standalone closing fence. */
export function isClosingFenceLine(text: string): number {
  return isClosingFence(text, skipSpaceTab(text, 0));
}

/**
 * Stage 1: Parse the colon count and attribute span from an opening fence line.
 * Returns `{ colonCount, attrFrom, attrTo, cursorAfterAttr }` or `undefined`
 * if the line is not a valid opening fence.
 */
function parseFenceColonsAndAttrs(
  text: string,
  prefix: FencePrefixInfo,
): { colonCount: number; attrFrom: number; attrTo: number; cursorAfterAttr: number } | undefined {
  let cursor = prefix.cursorAfterColons;

  // A bare `:::` with nothing after is a closing fence, not an opening one
  if (cursor >= text.length) return undefined;

  let attrFrom: number;
  let attrTo: number;

  if (text.charCodeAt(cursor) === OPEN_BRACE) {
    // Braced attribute block: ::: {.class #id key=val}
    const end = findMatchingBrace(text, cursor);
    if (end === -1) return undefined;
    attrFrom = cursor;
    attrTo = end;
    cursor = end;
    while (cursor < text.length && isSpaceTab(text.charCodeAt(cursor))) {
      cursor++;
    }
  } else {
    // Short-form: ::: ClassName
    // The first word is treated as the class name. We synthesize a
    // FencedDivAttributes node whose text is the bare class name
    // (no braces). extractDivClass() in fenced-div-attrs.ts handles
    // both braced and bare forms.
    const wordStart = cursor;
    while (
      cursor < text.length &&
      !isSpaceTab(text.charCodeAt(cursor))
    ) {
      cursor++;
    }
    if (cursor === wordStart) return undefined; // nothing after :::
    attrFrom = wordStart;
    attrTo = cursor;
    while (cursor < text.length && isSpaceTab(text.charCodeAt(cursor))) {
      cursor++;
    }
  }

  return {
    colonCount: prefix.colonCount,
    attrFrom,
    attrTo,
    cursorAfterAttr: cursor,
  };
}

/**
 * Parse an opening fence line. Returns fence info or undefined.
 * Opening fence: 3+ colons plus optional Pandoc attributes.
 *
 * FORMAT follows Pandoc: titles must be attributes, and self-closing
 * single-line divs are not canonical fenced-div blocks.
 */
function parseOpeningFence(
  text: string,
  prefix: FencePrefixInfo | undefined,
): OpeningFenceInfo | undefined {
  if (!prefix) return undefined;

  const stage1 = parseFenceColonsAndAttrs(text, prefix);
  if (!stage1) return undefined;

  const { colonCount, attrFrom, attrTo, cursorAfterAttr } = stage1;
  if (text.slice(cursorAfterAttr).trim().length > 0) {
    return undefined;
  }

  return {
    colonCount,
    attrFrom,
    attrTo,
    titleFrom: cursorAfterAttr,
    titleTo: cursorAfterAttr,
    isSelfClosing: false,
    closingFenceFrom: text.length,
    closingFenceTo: text.length,
  };
}

interface OpeningFenceInfo {
  readonly colonCount: number;
  readonly attrFrom: number;
  readonly attrTo: number;
  readonly titleFrom: number;
  readonly titleTo: number;
  /** True if the line ends with ::: (self-closing single-line div). */
  readonly isSelfClosing: boolean;
  /** End of the closing fence colons (only set when isSelfClosing). */
  readonly closingFenceFrom: number;
  readonly closingFenceTo: number;
}

/**
 * Generation counter that changes between parser invocations.
 *
 * Lezer's incremental parser reuses tree fragments when the composite
 * block's hash matches. For fenced divs, `takeNodes` can copy the
 * closing FencedDivFence from the old tree without calling the composite
 * callback, so the block never ends and swallows subsequent content.
 *
 * By encoding a changing generation in the composite value, the hash
 * differs between parses, preventing fragment reuse inside fenced divs.
 * This forces a full reparse of fenced div content (typically a few
 * lines — negligible performance cost).
 */
let parseGeneration = 0;

const PACKED_COLON_BITS = 8;
const PACKED_COLON_MASK = (1 << PACKED_COLON_BITS) - 1;
const PACKED_GENERATION_BITS = 16;
const PACKED_GENERATION_SHIFT = PACKED_COLON_BITS;
const PACKED_GENERATION_MASK = (1 << PACKED_GENERATION_BITS) - 1;

/** Pack colon count + generation into the composite value. */
function packValue(colonCount: number): number {
  return (colonCount & PACKED_COLON_MASK)
    | ((parseGeneration & PACKED_GENERATION_MASK) << PACKED_GENERATION_SHIFT);
}

/** Extract the colon count from a packed composite value. */
function unpackColonCount(value: number): number {
  return value & PACKED_COLON_MASK;
}

type LineMarkerRange = { readonly from: number; readonly to: number };

function lineMarkers(line: Line): readonly LineMarkerRange[] {
  return (line as Line & { readonly markers: readonly LineMarkerRange[] }).markers;
}

function hasMatchedClosingFenceMarker(
  cx: BlockContext,
  line: Line,
  closingColons: number,
): boolean {
  const from = cx.lineStart + line.pos;
  const to = from + closingColons;
  return lineMarkers(line).some((marker) => marker.from === from && marker.to === to);
}

/**
 * Composite callback for FencedDiv. Called on each new line to decide
 * if the block continues. Returns `true` to continue, `false` to end.
 *
 * The `value` parameter packs the colon count (bits 0–7) and current
 * parse generation (bits 8–23). Self-closing blocks negate that value
 * so the composite callback can terminate immediately.
 */
function fencedDivComposite(
  cx: BlockContext,
  line: Line,
  value: number,
): boolean {
  // Negative value signals a self-closing div — end immediately
  if (value < 0) return false;

  const colonCount = unpackColonCount(value);
  const closingColons = closingFenceColonCount(
    line.text,
    readFencePrefix(line.text, line.pos),
  );
  fencedDivLog(`composite line="${line.text.slice(0, 40)}" closing=${closingColons} need=${colonCount} lineStart=${cx.lineStart} depth=${cx.depth}`);
  if (closingColons >= colonCount) {
    fencedDivLog(`CLOSING at lineStart=${cx.lineStart} depth=${cx.depth}`);
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
    if (cx.lineStart === 0 && line.pos === 0) {
      parseGeneration = 0;
    }

    const prefix = readFencePrefix(line.text, line.pos);

    // Check for closing fence that was rejected by composite callback.
    // After the composite finishes, the closing fence line is re-processed
    // by block parsers. Consume only closers already matched by the composite;
    // a stray `:::` must remain visible source instead of disappearing.
    const closingColons = closingFenceColonCount(line.text, prefix);
    if (closingColons >= 3 && hasMatchedClosingFenceMarker(cx, line, closingColons)) {
      cx.nextLine();
      return true;
    }

    // Check for opening fence
    const info = parseOpeningFence(line.text, prefix);
    if (!info) return false;

    const fenceStart = cx.lineStart + line.pos;
    const fenceEnd = cx.lineStart + line.pos + info.colonCount;

    // Increment parse generation to prevent incremental parser from
    // reusing old tree fragments inside this composite block.
    parseGeneration = (parseGeneration + 1) & PACKED_GENERATION_MASK;
    fencedDivLog(`OPEN at ${fenceStart} colons=${info.colonCount} gen=${parseGeneration}`);

    // Start the composite block. Negative value signals self-closing
    // to the composite callback (it will end immediately).
    cx.startComposite(
      "FencedDiv",
      line.pos,
      info.isSelfClosing
        ? -packValue(info.colonCount)
        : packValue(info.colonCount),
    );

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
      // Parse inline content (math, bold, italic, etc.) within the title,
      // just like ATXHeading does for heading text. This makes all inline
      // render plugins work on fenced div titles automatically.
      // See CLAUDE.md "Block headers must behave like headings."
      const titleAbsFrom = cx.lineStart + info.titleFrom;
      const titleAbsTo = cx.lineStart + info.titleTo;
      const titleText = line.text.slice(info.titleFrom, info.titleTo);
      const inlineChildren = cx.parser.parseInline(titleText, titleAbsFrom);
      cx.addElement(
        cx.elt("FencedDivTitle", titleAbsFrom, titleAbsTo, inlineChildren),
      );
    }

    // Add closing fence marker for self-closing divs
    if (info.isSelfClosing) {
      cx.addElement(
        cx.elt(
          "FencedDivFence",
          cx.lineStart + info.closingFenceFrom,
          cx.lineStart + info.closingFenceTo,
        ),
      );
    }

    // Move the line's base past the entire opening fence so the block
    // parser loop doesn't re-process this line.
    line.moveBase(line.text.length);
    return null;
  },

  endLeaf(_cx: BlockContext, line: Line) {
    const prefix = readFencePrefix(line.text, line.pos);
    const closingColons = closingFenceColonCount(line.text, prefix);

    // Matched closing fences and opening fences should interrupt paragraphs.
    // Unmatched closing fences stay paragraph source for diagnostics.
    if (closingColons >= 3 && hasMatchedClosingFenceMarker(_cx, line, closingColons)) {
      return true;
    }
    return parseOpeningFence(line.text, prefix) !== undefined;
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
    { name: "FencedDivTitle" },
  ],
  props: [
    styleTags({
      FencedDivFence: tags.processingInstruction,
      FencedDivAttributes: tags.processingInstruction,
    }),
  ],
  parseBlock: [fencedDivBlockParser],
};
