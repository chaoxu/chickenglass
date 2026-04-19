import { FRONTMATTER_DELIMITER_RE } from "../../lib/frontmatter";

export { FRONTMATTER_DELIMITER_RE };

export const FENCED_DIV_START_RE = /^\s*(:{3,})(.*)$/;
export const DISPLAY_MATH_DOLLAR_START_RE = /^\s*\$\$(?!\$).*$/;
export const DISPLAY_MATH_DOLLAR_END_RE = /^\s*\$\$(?:\s+\{#[^}]+\})?\s*$/;
export const DISPLAY_MATH_BRACKET_START_RE = /^\s*\\\[\s*$/;
export const DISPLAY_MATH_BRACKET_END_RE = /^\s*\\\](?:\s+\{#[^}]+\})?\s*$/;
export const IMAGE_BLOCK_START_RE = /^\s*!\[[^\]\n]*\]\([^)]+\)\s*$/;
export const FOOTNOTE_DEFINITION_START_RE = /^\[\^[^\]]+\]:\s*(.*)$/;
export const TABLE_DIVIDER_RE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/;

export type SourceBlockVariant =
  | "display-math"
  | "fenced-div"
  | "footnote-definition"
  | "frontmatter"
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
      return startLineIndex;
    }
    for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      if (DISPLAY_MATH_DOLLAR_END_RE.test(lines[lineIndex] ?? "")) {
        return lineIndex;
      }
    }
  }

  if (DISPLAY_MATH_BRACKET_START_RE.test(startLine)) {
    for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      if (DISPLAY_MATH_BRACKET_END_RE.test(lines[lineIndex] ?? "")) {
        return lineIndex;
      }
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
      const innerMatch = line.match(FENCED_DIV_START_RE);
      if (
        innerMatch
        && (innerMatch[2] ?? "").trim().length > 0
        && (innerMatch[1]?.length ?? 0) >= 3
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

    const fencedMatch = line.match(FENCED_DIV_START_RE);
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

    if (IMAGE_BLOCK_START_RE.test(line)) {
      ranges.push(rangeFromLines(markdown, lines, lineOffsets, lineIndex, lineIndex, "image"));
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
