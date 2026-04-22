import { FRONTMATTER_DELIMITER_RE } from "../../lib/frontmatter";
import { MARKDOWN_IMAGE_LINE_RE, isMarkdownImageLine } from "../../lib/markdown-image";
import { isCanonicalFencedDivOpeningLine } from "../../parser/fenced-div";

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
  readonly endLineIndex: number;
  readonly from: number;
  readonly raw: string;
  readonly startLineIndex: number;
  readonly to: number;
  readonly variant: SourceBlockVariant;
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

function computeLineOffsets(lines: readonly string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
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
  return {
    endLineIndex,
    from,
    raw: markdown.slice(from, to),
    startLineIndex,
    to,
    variant,
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
      if (
        innerMatch
      ) {
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

export function collectSourceBlockRanges(markdown: string): SourceBlockRange[] {
  const lines = markdown.split("\n");
  const lineOffsets = computeLineOffsets(lines);
  const ranges: SourceBlockRange[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";

    if (lineIndex === 0 && FRONTMATTER_DELIMITER_RE.test(line)) {
      for (let endLineIndex = 1; endLineIndex < lines.length; endLineIndex += 1) {
        if (FRONTMATTER_DELIMITER_RE.test(lines[endLineIndex] ?? "")) {
          ranges.push(rangeFromLines(markdown, lines, lineOffsets, lineIndex, endLineIndex, "frontmatter"));
          lineIndex = endLineIndex;
          break;
        }
      }
      continue;
    }

    const fencedMatch = matchFencedDivStartLine(line);
    if (fencedMatch) {
      const endLineIndex = matchFencedDivEndLine(lines, lineIndex, fencedMatch, {
        allowLongerClosingFence: true,
        nested: true,
      });
      if (endLineIndex >= 0) {
        ranges.push(rangeFromLines(markdown, lines, lineOffsets, lineIndex, endLineIndex, "fenced-div"));
        lineIndex = endLineIndex;
      }
      continue;
    }

    const displayMathEndLine = matchDisplayMathEndLine(lines, lineIndex);
    if (displayMathEndLine >= 0) {
      ranges.push(rangeFromLines(markdown, lines, lineOffsets, lineIndex, displayMathEndLine, "display-math"));
      lineIndex = displayMathEndLine;
      continue;
    }

    const rawEquationEndLine = matchRawEquationEndLine(lines, lineIndex);
    if (rawEquationEndLine >= 0) {
      ranges.push(rangeFromLines(markdown, lines, lineOffsets, lineIndex, rawEquationEndLine, "display-math"));
      lineIndex = rawEquationEndLine;
      continue;
    }

    if (isMarkdownImageLine(line)) {
      ranges.push(rangeFromLines(markdown, lines, lineOffsets, lineIndex, lineIndex, "image"));
      continue;
    }

    const gridTableEndLine = matchGridTableEndLine(lines, lineIndex);
    if (gridTableEndLine >= 0) {
      ranges.push(rangeFromLines(markdown, lines, lineOffsets, lineIndex, gridTableEndLine, "grid-table"));
      lineIndex = gridTableEndLine;
      continue;
    }

    const footnoteEndLine = matchFootnoteDefinitionEndLine(lines, lineIndex);
    if (footnoteEndLine >= 0) {
      ranges.push(rangeFromLines(markdown, lines, lineOffsets, lineIndex, footnoteEndLine, "footnote-definition"));
      lineIndex = footnoteEndLine;
      continue;
    }

    const tableEndLine = matchTableEndLine(lines, lineIndex);
    if (tableEndLine >= 0) {
      ranges.push(rangeFromLines(markdown, lines, lineOffsets, lineIndex, tableEndLine, "table"));
      lineIndex = tableEndLine;
    }
  }

  return ranges;
}
