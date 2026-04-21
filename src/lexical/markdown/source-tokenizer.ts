import { HEADING_TRAILING_ATTRIBUTES_RE, parseHeadingLine } from "../../app/markdown/heading-syntax";
import { findNextInlineMathSource } from "../../lib/inline-math-source";
import { MARKDOWN_IMAGE_IMPORT_RE } from "../../lib/markdown-image";
import {
  BRACKETED_REFERENCE_IMPORT_RE,
  NARRATIVE_REFERENCE_IMPORT_RE,
} from "../../lib/reference-tokens";
import {
  getInlineTextFormatSpecs,
  type InlineTextFormatFamily,
} from "../runtime";
import {
  collectSourceBlockRanges,
  type SourceBlockRange,
} from "./block-scanner";
import { parseMarkdownLinkSource } from "./inline-source";

export type ParsedSourceRevealAdapterId =
  | "footnote-reference"
  | "heading-attribute"
  | "inline-image"
  | "inline-math"
  | "link"
  | "raw-block"
  | "reference";

export interface ParsedFormatSource {
  readonly from: number;
  readonly source: string;
  readonly to: number;
}

export interface ParsedSourceTextToken {
  readonly formatSource?: ParsedFormatSource;
  readonly formats: readonly InlineTextFormatFamily[];
  readonly from: number;
  readonly kind: "text";
  readonly source: string;
  readonly text: string;
  readonly to: number;
}

export interface ParsedSourceRevealToken {
  readonly adapterId: ParsedSourceRevealAdapterId;
  readonly children?: readonly ParsedSourceToken[];
  readonly from: number;
  readonly kind: "reveal";
  readonly source: string;
  readonly to: number;
}

export type ParsedSourceToken = ParsedSourceTextToken | ParsedSourceRevealToken;

const MARKDOWN_ESCAPE_RE = /\\([\\`*{}[\]()#+\-.!_>"])/g;

interface LinkAtSource {
  readonly labelFrom: number;
  readonly labelMarkdown: string;
  readonly raw: string;
  readonly to: number;
}

function lineOffsets(lines: readonly string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function unescapeMarkdownText(source: string): string {
  return source.replace(MARKDOWN_ESCAPE_RE, "$1");
}

function addFormat(
  formats: readonly InlineTextFormatFamily[],
  format: InlineTextFormatFamily,
): readonly InlineTextFormatFamily[] {
  if (formats.includes(format)) {
    return formats;
  }
  return getInlineTextFormatSpecs()
    .map((spec) => spec.family)
    .filter((family) => family === format || formats.includes(family));
}

function textToken(
  source: string,
  from: number,
  to: number,
  formats: readonly InlineTextFormatFamily[],
): ParsedSourceTextToken | null {
  if (from >= to) {
    return null;
  }
  const raw = source.slice(from, to);
  const text = unescapeMarkdownText(raw);
  return text.length === 0
    ? null
    : {
        formats,
        from,
        kind: "text",
        source: raw,
        text,
        to,
      };
}

function findLabelEnd(source: string, labelStart: number, limit: number): number {
  let depth = 0;
  for (let index = labelStart; index < limit; index += 1) {
    const char = source[index];
    if (isEscaped(source, index)) {
      continue;
    }
    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function findLinkDestinationEnd(source: string, openParen: number, limit: number): number {
  let depth = 0;
  let inAngleDestination = false;
  for (let index = openParen; index < limit; index += 1) {
    const char = source[index];
    if (isEscaped(source, index)) {
      continue;
    }
    if (inAngleDestination) {
      if (char === ">") {
        inAngleDestination = false;
      }
      continue;
    }
    if (char === "<" && index === openParen + 1) {
      inAngleDestination = true;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function parseLinkAt(source: string, from: number, to: number): LinkAtSource | null {
  if (source[from] !== "[" || source[from - 1] === "!") {
    return null;
  }
  const labelEnd = findLabelEnd(source, from, to);
  if (labelEnd < 0 || source[labelEnd + 1] !== "(") {
    return null;
  }
  const linkEnd = findLinkDestinationEnd(source, labelEnd + 1, to);
  if (linkEnd < 0) {
    return null;
  }
  const raw = source.slice(from, linkEnd + 1);
  const parsed = parseMarkdownLinkSource(raw);
  return parsed
    ? {
        labelFrom: from + 1,
        labelMarkdown: parsed.labelMarkdown,
        raw,
        to: linkEnd + 1,
      }
    : null;
}

function anchoredMatch(
  regex: RegExp,
  source: string,
  from: number,
  to: number,
): RegExpMatchArray | null {
  const match = source.slice(from, to).match(regex);
  return match?.index === 0 ? match : null;
}

function parseInlineMathAt(
  source: string,
  from: number,
  to: number,
): ParsedSourceRevealToken | null {
  const parsed = findNextInlineMathSource(source.slice(from, to), 0, {
    requireTightDollar: true,
  });
  return parsed?.from === 0
    ? {
        adapterId: "inline-math",
        from,
        kind: "reveal",
        source: parsed.raw,
        to: from + parsed.raw.length,
      }
    : null;
}

function parseInlineImageAt(
  source: string,
  from: number,
  to: number,
): ParsedSourceRevealToken | null {
  const match = anchoredMatch(MARKDOWN_IMAGE_IMPORT_RE, source, from, to);
  return match
    ? {
        adapterId: "inline-image",
        from,
        kind: "reveal",
        source: match[0],
        to: from + match[0].length,
      }
    : null;
}

function parseFootnoteReferenceAt(
  source: string,
  from: number,
  to: number,
): ParsedSourceRevealToken | null {
  const match = anchoredMatch(/^\[\^[^\]\n]+\]/, source, from, to);
  return match
    ? {
        adapterId: "footnote-reference",
        from,
        kind: "reveal",
        source: match[0],
        to: from + match[0].length,
      }
    : null;
}

function parseReferenceAt(
  source: string,
  from: number,
  to: number,
): ParsedSourceRevealToken | null {
  const bracketed = anchoredMatch(BRACKETED_REFERENCE_IMPORT_RE, source, from, to);
  if (bracketed) {
    return {
      adapterId: "reference",
      from,
      kind: "reveal",
      source: bracketed[0],
      to: from + bracketed[0].length,
    };
  }

  if (from > 0 && /[\w@]/.test(source[from - 1] ?? "")) {
    return null;
  }
  const narrative = anchoredMatch(NARRATIVE_REFERENCE_IMPORT_RE, source, from, to);
  return narrative
    ? {
        adapterId: "reference",
        from,
        kind: "reveal",
        source: narrative[0],
        to: from + narrative[0].length,
      }
    : null;
}

const FORMAT_CANDIDATES = [
  { close: "**", family: "bold" as const, open: "**" },
  { close: "__", family: "bold" as const, open: "__" },
  { close: "~~", family: "strikethrough" as const, open: "~~" },
  { close: "==", family: "highlight" as const, open: "==" },
  { close: "`", family: "code" as const, open: "`" },
  { close: "*", family: "italic" as const, open: "*" },
  { close: "_", family: "italic" as const, open: "_" },
];

function findClosingDelimiter(
  source: string,
  from: number,
  to: number,
  delimiter: string,
): number {
  for (let cursor = from; cursor <= to - delimiter.length; cursor += 1) {
    if (source.startsWith(delimiter, cursor) && !isEscaped(source, cursor)) {
      return cursor;
    }
  }
  return -1;
}

function parseFormatAt(
  source: string,
  from: number,
  to: number,
  formats: readonly InlineTextFormatFamily[],
): { readonly tokens: readonly ParsedSourceToken[]; readonly to: number } | null {
  if (isEscaped(source, from)) {
    return null;
  }
  const candidate = FORMAT_CANDIDATES.find(({ open }) => source.startsWith(open, from));
  if (!candidate) {
    return null;
  }
  const innerFrom = from + candidate.open.length;
  const closeFrom = findClosingDelimiter(source, innerFrom + 1, to, candidate.close);
  if (closeFrom < 0) {
    return null;
  }
  const nextTo = closeFrom + candidate.close.length;
  const nextFormats = addFormat(formats, candidate.family);
  const innerTokens = parseInlineSegment(source, innerFrom, closeFrom, nextFormats);
  if (innerTokens.length === 1 && innerTokens[0]?.kind === "text") {
    const [onlyToken] = innerTokens;
    return {
      to: nextTo,
      tokens: [{
        ...onlyToken,
        formatSource: {
          from,
          source: source.slice(from, nextTo),
          to: nextTo,
        },
      }],
    };
  }
  return {
    to: nextTo,
    tokens: innerTokens,
  };
}

function parseSpecialInlineAt(
  source: string,
  from: number,
  to: number,
  formats: readonly InlineTextFormatFamily[],
): { readonly tokens: readonly ParsedSourceToken[]; readonly to: number } | null {
  const formatted = parseFormatAt(source, from, to, formats);
  if (formatted) {
    return formatted;
  }

  const inlineMath = parseInlineMathAt(source, from, to);
  if (inlineMath) {
    return { tokens: [inlineMath], to: inlineMath.to };
  }

  const inlineImage = parseInlineImageAt(source, from, to);
  if (inlineImage) {
    return { tokens: [inlineImage], to: inlineImage.to };
  }

  const link = parseLinkAt(source, from, to);
  if (link) {
    return {
      to: link.to,
      tokens: [{
        adapterId: "link",
        children: parseInlineSegment(
          link.labelMarkdown,
          0,
          link.labelMarkdown.length,
          formats,
        ).map((token) => shiftToken(token, link.labelFrom)),
        from,
        kind: "reveal",
        source: link.raw,
        to: link.to,
      }],
    };
  }

  const footnote = parseFootnoteReferenceAt(source, from, to);
  if (footnote) {
    return { tokens: [footnote], to: footnote.to };
  }

  const reference = parseReferenceAt(source, from, to);
  if (reference) {
    return { tokens: [reference], to: reference.to };
  }

  return null;
}

function shiftToken(token: ParsedSourceToken, offset: number): ParsedSourceToken {
  if (token.kind === "text") {
    return {
      ...token,
      formatSource: token.formatSource
        ? {
            ...token.formatSource,
            from: token.formatSource.from + offset,
            to: token.formatSource.to + offset,
          }
        : undefined,
      from: token.from + offset,
      to: token.to + offset,
    };
  }
  return {
    ...token,
    children: token.children?.map((child) => shiftToken(child, offset)),
    from: token.from + offset,
    to: token.to + offset,
  };
}

function parseInlineSegment(
  source: string,
  from: number,
  to: number,
  formats: readonly InlineTextFormatFamily[],
): readonly ParsedSourceToken[] {
  const tokens: ParsedSourceToken[] = [];
  let cursor = from;
  let textFrom = from;

  const flushText = (until: number) => {
    const token = textToken(source, textFrom, until, formats);
    if (token) {
      tokens.push(token);
    }
  };

  while (cursor < to) {
    const parsed = parseSpecialInlineAt(source, cursor, to, formats);
    if (parsed) {
      flushText(cursor);
      tokens.push(...parsed.tokens);
      cursor = parsed.to;
      textFrom = cursor;
      continue;
    }
    cursor += 1;
  }

  flushText(to);
  return tokens;
}

function parseHeadingLineTokens(
  markdown: string,
  line: string,
  lineOffset: number,
): readonly ParsedSourceToken[] {
  const heading = parseHeadingLine(line);
  if (!heading) {
    return [];
  }

  const attrMatch = line.match(HEADING_TRAILING_ATTRIBUTES_RE);
  const attrFrom = attrMatch?.index ?? null;
  const inlineTo = attrFrom ?? heading.textTo;
  const tokens = [
    ...parseInlineSegment(markdown, lineOffset + heading.textFrom, lineOffset + inlineTo, []),
  ];
  if (attrMatch) {
    const matchIndex = attrMatch.index ?? 0;
    tokens.push({
      adapterId: "heading-attribute",
      from: lineOffset + matchIndex,
      kind: "reveal",
      source: attrMatch[0],
      to: lineOffset + matchIndex + attrMatch[0].length,
    });
  }
  return tokens;
}

function inlineStartForLine(line: string): number {
  const checklist = line.match(/^(\s*)(?:[-*+]\s+)?\[[ xX]\]\s+/);
  if (checklist) {
    return checklist[0].length;
  }

  const unordered = line.match(/^(\s*)[-*+]\s+/);
  if (unordered) {
    return unordered[0].length;
  }

  const ordered = line.match(/^(\s*)\d{1,}\.\s+/);
  if (ordered) {
    return ordered[0].length;
  }

  const quote = line.match(/^>\s?/);
  if (quote) {
    return quote[0].length;
  }

  return 0;
}

function parseNormalLineTokens(
  markdown: string,
  line: string,
  lineOffset: number,
): readonly ParsedSourceToken[] {
  const headingTokens = parseHeadingLineTokens(markdown, line, lineOffset);
  if (headingTokens.length > 0) {
    return headingTokens;
  }

  const start = inlineStartForLine(line);
  return parseInlineSegment(markdown, lineOffset + start, lineOffset + line.length, []);
}

interface TableCellRange {
  readonly from: number;
  readonly to: number;
}

function trimCellRange(line: string, from: number, to: number, lineOffset: number): TableCellRange {
  let nextFrom = from;
  let nextTo = to;
  while (nextFrom < nextTo && /\s/.test(line[nextFrom] ?? "")) {
    nextFrom += 1;
  }
  while (nextTo > nextFrom && /\s/.test(line[nextTo - 1] ?? "")) {
    nextTo -= 1;
  }
  return {
    from: lineOffset + nextFrom,
    to: lineOffset + nextTo,
  };
}

function tableCellRanges(line: string, lineOffset: number): readonly TableCellRange[] {
  const firstPipe = line.indexOf("|");
  const lastPipe = line.lastIndexOf("|");
  if (firstPipe < 0 || lastPipe <= firstPipe) {
    return [];
  }

  const ranges: TableCellRange[] = [];
  let cellFrom = firstPipe + 1;
  for (let cursor = cellFrom; cursor <= lastPipe; cursor += 1) {
    if (cursor === lastPipe || (line[cursor] === "|" && !isEscaped(line, cursor))) {
      ranges.push(trimCellRange(line, cellFrom, cursor, lineOffset));
      cellFrom = cursor + 1;
    }
  }
  return ranges;
}

function parseTableTokens(
  markdown: string,
  lines: readonly string[],
  offsets: readonly number[],
  range: SourceBlockRange,
): readonly ParsedSourceToken[] {
  const tokens: ParsedSourceToken[] = [];
  for (let lineIndex = range.startLineIndex; lineIndex <= range.endLineIndex; lineIndex += 1) {
    if (lineIndex === range.startLineIndex + 1) {
      continue;
    }
    const line = lines[lineIndex] ?? "";
    const lineOffset = offsets[lineIndex] ?? 0;
    for (const cell of tableCellRanges(line, lineOffset)) {
      tokens.push(...parseInlineSegment(markdown, cell.from, cell.to, []));
    }
  }
  return tokens;
}

function sourceBlocksForImport(
  markdown: string,
  lines: readonly string[],
  offsets: readonly number[],
): SourceBlockRange[] {
  return collectSourceBlockRanges(markdown).map((range) => {
    if (range.variant !== "footnote-definition") {
      return range;
    }
    const nextLineIndex = range.endLineIndex + 1;
    const nextLine = lines[nextLineIndex];
    if (nextLine === undefined || !/^\s*$/.test(nextLine)) {
      return range;
    }
    const to = (offsets[nextLineIndex] ?? range.to) + nextLine.length;
    return {
      ...range,
      endLineIndex: nextLineIndex,
      raw: markdown.slice(range.from, to),
      to,
    };
  });
}

export function parseMarkdownSourceTokens(markdown: string): readonly ParsedSourceToken[] {
  const lines = markdown.split("\n");
  const offsets = lineOffsets(lines);
  const sourceBlocks = sourceBlocksForImport(markdown, lines, offsets);
  const sourceBlockByLine = new Map(
    sourceBlocks.map((range) => [range.startLineIndex, range]),
  );
  const tokens: ParsedSourceToken[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const block = sourceBlockByLine.get(lineIndex);
    if (block) {
      if (block.variant === "table") {
        tokens.push(...parseTableTokens(markdown, lines, offsets, block));
      } else {
        tokens.push({
          adapterId: "raw-block",
          from: block.from,
          kind: "reveal",
          source: block.raw,
          to: block.to,
        });
      }
      lineIndex = block.endLineIndex;
      continue;
    }

    const line = lines[lineIndex] ?? "";
    if (line.length === 0) {
      continue;
    }
    tokens.push(...parseNormalLineTokens(markdown, line, offsets[lineIndex] ?? 0));
  }

  return tokens;
}
