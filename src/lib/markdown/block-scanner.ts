import { FRONTMATTER_DELIMITER_RE } from "../frontmatter-delimiter.js";
import { MARKDOWN_IMAGE_LINE_RE, isMarkdownImageLine } from "../markdown-image";
import { isCanonicalFencedDivOpeningLine } from "../../parser/fenced-div";
import {
  computeLineOffsets,
  lineEndOffset,
  lineStartOffset,
  offsetAfterLine,
} from "./block-scanner-lines";

export { FRONTMATTER_DELIMITER_RE };

export const FENCED_DIV_START_RE = /^\s*(:{3,})(.*)$/;
export const DISPLAY_MATH_DOLLAR_START_RE = /^\s*\$\$(?!\$).*$/;
export const DISPLAY_MATH_DOLLAR_EMPTY_START_RE = /^\s*\$\$\s*$/;
export const DISPLAY_MATH_DOLLAR_END_RE = /^\s*\$\$\s*(?:\{#[A-Za-z][\w.:-]*\})?\s*$/;
export const DISPLAY_MATH_BRACKET_BLOCK_START_RE = /^\s*\\\[/;
export const DISPLAY_MATH_BRACKET_START_RE = /^\s*\\\[\s*$/;
export const DISPLAY_MATH_BRACKET_END_RE = /^\s*\\\]\s*(?:\{#[A-Za-z][\w.:-]*\})?\s*$/;
export const RAW_EQUATION_START_RE = /^\s*\\begin\{equation\*?\}(?:\s*\\label\{[A-Za-z][\w.:-]*\})?\s*$/;
export const RAW_EQUATION_END_RE = /^\s*\\end\{equation\*?\}\s*$/;
export const IMAGE_BLOCK_START_RE = MARKDOWN_IMAGE_LINE_RE;
export const FOOTNOTE_DEFINITION_START_RE = /^\[\^[^\]]+\]:\s*(.*)$/;
export const TABLE_DIVIDER_RE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/;
export const GRID_TABLE_SEPARATOR_RE = /^\s*\+(?:[=-]+\+)+\s*$/;
export const GRID_TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

export type SourceBlockVariant =
  | "display-math"
  | "fenced-div"
  | "footnote-definition"
  | "frontmatter"
  | "grid-table"
  | "image"
  | "table";

export interface SourceBlockRange {
  readonly bodyFrom: number;
  readonly bodyTo: number;
  readonly endLineIndex: number;
  readonly from: number;
  readonly raw: string;
  readonly startLineIndex: number;
  readonly to: number;
  readonly variant: SourceBlockVariant;
}

export type SourceBoundaryVariant = SourceBlockVariant | "line";

export interface SourceBoundaryRange {
  readonly bodyFrom: number;
  readonly bodyTo: number;
  readonly endLineIndex: number;
  readonly from: number;
  readonly raw: string;
  readonly startLineIndex: number;
  readonly to: number;
  readonly variant: SourceBoundaryVariant;
}

export interface CollectSourceBlockRangesOptions {
  readonly includeFootnoteTerminatingBlank?: boolean;
}

export function matchFencedDivStartLine(
  line: string,
  options: { readonly requireHeader?: boolean } = {},
): RegExpMatchArray | null {
  const match = line.match(FENCED_DIV_START_RE);
  if (!match || (match[1]?.length ?? 0) < 3) {
    return null;
  }
  if (options.requireHeader && (match[2] ?? "").trim().length === 0) {
    return null;
  }
  if (!isCanonicalFencedDivOpeningLine(line)) {
    return null;
  }
  return match;
}

export function isDisplayMathDollarExpansionLine(line: string): boolean {
  return DISPLAY_MATH_DOLLAR_EMPTY_START_RE.test(line);
}

export function isDisplayMathBracketExpansionLine(line: string): boolean {
  return DISPLAY_MATH_BRACKET_START_RE.test(line);
}

function isDisplayMathDollarClosingSuffix(text: string): boolean {
  return /^\s*(?:\{#[A-Za-z][\w.:-]*\})?\s*$/.test(text);
}

function isDisplayMathBracketClosingSuffix(text: string): boolean {
  return /^\s*(?:\{#[A-Za-z][\w.:-]*\})?\s*$/.test(text);
}

export function computeSourceLineOffsets(lines: readonly string[]): number[] {
  return computeLineOffsets(lines);
}

function multilineInteriorRange(
  lines: readonly string[],
  lineOffsets: readonly number[],
  startLineIndex: number,
  endLineIndex: number,
): { readonly bodyFrom: number; readonly bodyTo: number } {
  const bodyFrom = offsetAfterLine(lines, lineOffsets, startLineIndex);
  const closingLineStart = lineStartOffset(lineOffsets, endLineIndex);
  return {
    bodyFrom,
    bodyTo: Math.max(bodyFrom, closingLineStart - 1),
  };
}

function displayMathBodyRange(
  lines: readonly string[],
  lineOffsets: readonly number[],
  startLineIndex: number,
  endLineIndex: number,
): { readonly bodyFrom: number; readonly bodyTo: number } {
  const startLine = lines[startLineIndex] ?? "";
  const startOffset = lineStartOffset(lineOffsets, startLineIndex);
  const multilineBodyFrom = (
    delimiterOffset: number,
    delimiterLength: number,
  ): number => {
    const contentOffset = delimiterOffset + delimiterLength;
    const openerLineContent = startLine.slice(contentOffset);
    return openerLineContent.trim().length > 0
      ? startOffset + contentOffset
      : offsetAfterLine(lines, lineOffsets, startLineIndex);
  };

  const bracketOpen = startLine.indexOf("\\[");
  if (bracketOpen >= 0) {
    const bracketClose = startLineIndex === endLineIndex
      ? startLine.indexOf("\\]", bracketOpen + 2)
      : -1;
    if (bracketOpen >= 0 && bracketClose >= 0) {
      return {
        bodyFrom: startOffset + bracketOpen + 2,
        bodyTo: startOffset + bracketClose,
      };
    }
    const bodyFrom = multilineBodyFrom(bracketOpen, 2);
    const closingLineStart = lineStartOffset(lineOffsets, endLineIndex);
    return {
      bodyFrom,
      bodyTo: Math.max(bodyFrom, closingLineStart - 1),
    };
  }

  const dollarOpen = startLine.indexOf("$$");
  if (dollarOpen >= 0) {
    const dollarClose = startLineIndex === endLineIndex
      ? startLine.indexOf("$$", dollarOpen + 2)
      : -1;
    if (dollarOpen >= 0 && dollarClose >= 0) {
      return {
        bodyFrom: startOffset + dollarOpen + 2,
        bodyTo: startOffset + dollarClose,
      };
    }
    const bodyFrom = multilineBodyFrom(dollarOpen, 2);
    const closingLineStart = lineStartOffset(lineOffsets, endLineIndex);
    return {
      bodyFrom,
      bodyTo: Math.max(bodyFrom, closingLineStart - 1),
    };
  }

  return multilineInteriorRange(lines, lineOffsets, startLineIndex, endLineIndex);
}

function footnoteBodyRange(
  lines: readonly string[],
  lineOffsets: readonly number[],
  startLineIndex: number,
  endLineIndex: number,
): { readonly bodyFrom: number; readonly bodyTo: number } {
  const firstLine = lines[startLineIndex] ?? "";
  const match = firstLine.match(FOOTNOTE_DEFINITION_START_RE);
  const firstBody = match?.[1] ?? "";
  const contentEndLine = /^\s*$/.test(lines[endLineIndex] ?? "")
    ? endLineIndex - 1
    : endLineIndex;
  const bodyFrom = firstBody.length > 0 || contentEndLine === startLineIndex
    ? lineEndOffset(lines, lineOffsets, startLineIndex) - firstBody.length
    : offsetAfterLine(lines, lineOffsets, startLineIndex);
  return {
    bodyFrom,
    bodyTo: Math.max(bodyFrom, lineEndOffset(lines, lineOffsets, contentEndLine)),
  };
}

function sourceBlockBodyRange(
  lines: readonly string[],
  lineOffsets: readonly number[],
  startLineIndex: number,
  endLineIndex: number,
  variant: SourceBlockVariant,
  from: number,
  to: number,
): { readonly bodyFrom: number; readonly bodyTo: number } {
  switch (variant) {
    case "display-math":
      return displayMathBodyRange(lines, lineOffsets, startLineIndex, endLineIndex);
    case "fenced-div":
    case "frontmatter":
      return multilineInteriorRange(lines, lineOffsets, startLineIndex, endLineIndex);
    case "footnote-definition":
      return footnoteBodyRange(lines, lineOffsets, startLineIndex, endLineIndex);
    case "grid-table":
    case "image":
    case "table":
      return { bodyFrom: from, bodyTo: to };
  }
}

function rangeFromLines(
  markdown: string,
  lines: readonly string[],
  lineOffsets: readonly number[],
  startLineIndex: number,
  endLineIndex: number,
  variant: SourceBlockVariant,
): SourceBlockRange {
  const from = lineOffsets[startLineIndex] ?? 0;
  const endLine = lines[endLineIndex] ?? "";
  const to = (lineOffsets[endLineIndex] ?? from) + endLine.length;
  const body = sourceBlockBodyRange(
    lines,
    lineOffsets,
    startLineIndex,
    endLineIndex,
    variant,
    from,
    to,
  );
  return {
    ...body,
    endLineIndex,
    from,
    raw: markdown.slice(from, to),
    startLineIndex,
    to,
    variant,
  };
}

function lineBoundaryFromLine(
  markdown: string,
  lines: readonly string[],
  lineOffsets: readonly number[],
  lineIndex: number,
): SourceBoundaryRange {
  const from = lineStartOffset(lineOffsets, lineIndex);
  const to = lineEndOffset(lines, lineOffsets, lineIndex);
  return {
    bodyFrom: from,
    bodyTo: to,
    endLineIndex: lineIndex,
    from,
    raw: markdown.slice(from, to),
    startLineIndex: lineIndex,
    to,
    variant: "line",
  };
}

export function matchDisplayMathEndLine(
  lines: readonly string[],
  startLineIndex: number,
): number {
  const startLine = lines[startLineIndex] ?? "";
  if (DISPLAY_MATH_DOLLAR_START_RE.test(startLine)) {
    const sameLineEnd = startLine.indexOf("$$", startLine.indexOf("$$") + 2);
    if (sameLineEnd !== -1) {
      return isDisplayMathDollarClosingSuffix(startLine.slice(sameLineEnd + 2)) ? startLineIndex : -1;
    }
    for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      if (DISPLAY_MATH_DOLLAR_END_RE.test(lines[lineIndex] ?? "")) {
        return lineIndex;
      }
    }
  }

  if (DISPLAY_MATH_BRACKET_BLOCK_START_RE.test(startLine)) {
    const sameLineEnd = startLine.indexOf("\\]", startLine.indexOf("\\[") + 2);
    if (sameLineEnd !== -1) {
      return isDisplayMathBracketClosingSuffix(startLine.slice(sameLineEnd + 2))
        ? startLineIndex
        : -1;
    }
    for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      if (DISPLAY_MATH_BRACKET_END_RE.test(lines[lineIndex] ?? "")) {
        return lineIndex;
      }
    }
  }

  return -1;
}

export function matchRawEquationEndLine(
  lines: readonly string[],
  startLineIndex: number,
): number {
  if (!RAW_EQUATION_START_RE.test(lines[startLineIndex] ?? "")) {
    return -1;
  }
  for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    if (RAW_EQUATION_END_RE.test(lines[lineIndex] ?? "")) {
      return lineIndex;
    }
  }
  return -1;
}

export function matchFencedDivEndLine(
  lines: readonly string[],
  startLineIndex: number,
  startMatch: RegExpMatchArray,
  options: {
    readonly allowLongerClosingFence?: boolean;
    readonly nested?: boolean;
    readonly requireHeader?: boolean;
  } = {},
): number {
  const colonCount = startMatch[1]?.length ?? 0;
  const header = startMatch[2] ?? "";
  if (colonCount < 3 || (options.requireHeader && header.trim().length === 0)) {
    return -1;
  }

  const closingFenceFor = (count: number) =>
    options.allowLongerClosingFence
      ? new RegExp(`^\\s*:{${count},}\\s*$`)
      : new RegExp(`^\\s*:{${count}}\\s*$`);

  if (options.nested) {
    const stack = [colonCount];
    for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] ?? "";
      const innerMatch = matchFencedDivStartLine(line);
      if (innerMatch) {
        stack.push(innerMatch[1]?.length ?? 0);
        continue;
      }

      const currentFenceLength = stack[stack.length - 1];
      if (currentFenceLength !== undefined && closingFenceFor(currentFenceLength).test(line)) {
        stack.pop();
        if (stack.length === 0) {
          return lineIndex;
        }
      }
    }
    return -1;
  }

  const closingFence = closingFenceFor(colonCount);

  for (let lineIndex = startLineIndex; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (lineIndex > startLineIndex && closingFence.test(line)) {
      return lineIndex;
    }
  }

  return -1;
}

export function matchFootnoteDefinitionEndLine(
  lines: readonly string[],
  startLineIndex: number,
  options: { readonly includeTerminatingBlank?: boolean } = {},
): number {
  if (!FOOTNOTE_DEFINITION_START_RE.test(lines[startLineIndex] ?? "")) {
    return -1;
  }

  let endLineIndex = startLineIndex;
  for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (/^\s*$/.test(line)) {
      return options.includeTerminatingBlank ? lineIndex : endLineIndex;
    }
    if (!/^\s{2,4}\S/.test(line)) {
      break;
    }
    endLineIndex = lineIndex;
  }
  return endLineIndex;
}

export function matchTableEndLine(
  lines: readonly string[],
  startLineIndex: number,
): number {
  const startLine = lines[startLineIndex] ?? "";
  const dividerLine = lines[startLineIndex + 1] ?? "";
  if (!/\|/.test(startLine) || !TABLE_DIVIDER_RE.test(dividerLine)) {
    return -1;
  }

  let endLineIndex = startLineIndex + 1;
  for (let lineIndex = startLineIndex + 2; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (!/\|/.test(line) || /^\s*$/.test(line)) {
      break;
    }
    endLineIndex = lineIndex;
  }
  return endLineIndex;
}

export function matchGridTableEndLine(
  lines: readonly string[],
  startLineIndex: number,
): number {
  if (!GRID_TABLE_SEPARATOR_RE.test(lines[startLineIndex] ?? "")) {
    return -1;
  }

  let endLineIndex = -1;
  let sawRow = false;
  for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (GRID_TABLE_ROW_RE.test(line)) {
      sawRow = true;
      continue;
    }
    if (GRID_TABLE_SEPARATOR_RE.test(line)) {
      if (sawRow) {
        endLineIndex = lineIndex;
      }
      continue;
    }
    break;
  }

  return endLineIndex;
}

export function matchSourceBlockRangeAtLine(
  markdown: string,
  lines: readonly string[],
  lineIndex: number,
  options: CollectSourceBlockRangesOptions = {},
  lineOffsets: readonly number[] = computeLineOffsets(lines),
): SourceBlockRange | null {
  const line = lines[lineIndex] ?? "";

  if (lineIndex === 0 && FRONTMATTER_DELIMITER_RE.test(line)) {
    for (let endLineIndex = 1; endLineIndex < lines.length; endLineIndex += 1) {
      if (FRONTMATTER_DELIMITER_RE.test(lines[endLineIndex] ?? "")) {
        return rangeFromLines(markdown, lines, lineOffsets, lineIndex, endLineIndex, "frontmatter");
      }
    }
    return null;
  }

  const fencedMatch = matchFencedDivStartLine(line);
  if (fencedMatch) {
    const endLineIndex = matchFencedDivEndLine(lines, lineIndex, fencedMatch, {
      allowLongerClosingFence: true,
      nested: true,
    });
    return endLineIndex >= 0
      ? rangeFromLines(markdown, lines, lineOffsets, lineIndex, endLineIndex, "fenced-div")
      : null;
  }

  const displayMathEndLine = matchDisplayMathEndLine(lines, lineIndex);
  if (displayMathEndLine >= 0) {
    return rangeFromLines(markdown, lines, lineOffsets, lineIndex, displayMathEndLine, "display-math");
  }

  const rawEquationEndLine = matchRawEquationEndLine(lines, lineIndex);
  if (rawEquationEndLine >= 0) {
    return rangeFromLines(markdown, lines, lineOffsets, lineIndex, rawEquationEndLine, "display-math");
  }

  if (isMarkdownImageLine(line)) {
    return rangeFromLines(markdown, lines, lineOffsets, lineIndex, lineIndex, "image");
  }

  const gridTableEndLine = matchGridTableEndLine(lines, lineIndex);
  if (gridTableEndLine >= 0) {
    return rangeFromLines(markdown, lines, lineOffsets, lineIndex, gridTableEndLine, "grid-table");
  }

  const footnoteEndLine = matchFootnoteDefinitionEndLine(lines, lineIndex, {
    includeTerminatingBlank: options.includeFootnoteTerminatingBlank,
  });
  if (footnoteEndLine >= 0) {
    return rangeFromLines(markdown, lines, lineOffsets, lineIndex, footnoteEndLine, "footnote-definition");
  }

  const tableEndLine = matchTableEndLine(lines, lineIndex);
  return tableEndLine >= 0
    ? rangeFromLines(markdown, lines, lineOffsets, lineIndex, tableEndLine, "table")
    : null;
}

export function collectSourceBlockRanges(
  markdown: string,
  options: CollectSourceBlockRangesOptions = {},
): SourceBlockRange[] {
  const lines = markdown.split("\n");
  const lineOffsets = computeLineOffsets(lines);
  const ranges: SourceBlockRange[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const range = matchSourceBlockRangeAtLine(markdown, lines, lineIndex, options, lineOffsets);
    if (range) {
      ranges.push(range);
      lineIndex = range.endLineIndex;
    }
  }

  return ranges;
}

export function collectSourceBoundaryRanges(
  markdown: string,
  options: CollectSourceBlockRangesOptions = {},
): SourceBoundaryRange[] {
  const lines = markdown.split("\n");
  const lineOffsets = computeLineOffsets(lines);
  const ranges: SourceBoundaryRange[] = [];

  for (let lineIndex = 0; lineIndex < lines.length;) {
    const sourceBlock = matchSourceBlockRangeAtLine(
      markdown,
      lines,
      lineIndex,
      options,
      lineOffsets,
    );
    if (sourceBlock) {
      ranges.push(sourceBlock);
      lineIndex = sourceBlock.endLineIndex + 1;
      continue;
    }

    ranges.push(lineBoundaryFromLine(markdown, lines, lineOffsets, lineIndex));
    lineIndex += 1;
  }

  return ranges;
}

export type SourceBoundaryRangeWithIndex = SourceBoundaryRange & {
  readonly index: number;
};

export function findSourceBoundaryRangeContainingChange(
  markdown: string,
  change: { readonly from: number; readonly to: number },
  options: CollectSourceBlockRangesOptions = {},
): SourceBoundaryRangeWithIndex | null {
  const lines = markdown.split("\n");
  const lineOffsets = computeLineOffsets(lines);
  let index = 0;

  for (let lineIndex = 0; lineIndex < lines.length;) {
    const sourceBlock = matchSourceBlockRangeAtLine(
      markdown,
      lines,
      lineIndex,
      options,
      lineOffsets,
    );
    const boundary = sourceBlock
      ?? lineBoundaryFromLine(markdown, lines, lineOffsets, lineIndex);

    if (change.from >= boundary.from && change.to <= boundary.to) {
      return { ...boundary, index };
    }
    if (change.to < boundary.from) {
      return null;
    }

    lineIndex = boundary.endLineIndex + 1;
    index += 1;
  }

  return null;
}
