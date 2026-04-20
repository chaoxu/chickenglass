import type { ParsedFencedDivBlock } from "./markdown/block-syntax";

function firstLineLength(raw: string): number {
  const firstNewline = raw.indexOf("\n");
  return firstNewline < 0 ? raw.length : firstNewline;
}

export function fencedDivBodyMarkdownOffset(raw: string): number {
  const firstLength = firstLineLength(raw);
  return firstLength >= raw.length ? raw.length : firstLength + 1;
}

export function fencedDivTrimmedBodyMarkdownOffset(raw: string): number {
  const bodyStart = fencedDivBodyMarkdownOffset(raw);
  const bodyEnd = raw.lastIndexOf("\n");
  const bodyMarkdown = raw.slice(bodyStart, bodyEnd > bodyStart ? bodyEnd : raw.length);
  return bodyStart + bodyMarkdown.length - bodyMarkdown.trimStart().length;
}

export function fencedDivTitleMarkdownOffset(
  raw: string,
  parsed: ParsedFencedDivBlock,
): number | null {
  const title = parsed.titleMarkdown;
  if (!title) {
    return null;
  }

  const opener = raw.slice(0, firstLineLength(raw));
  const fenceMatch = opener.match(/^\s*:{3,}/);
  if (!fenceMatch) {
    return null;
  }

  const headerPadding = opener.slice(fenceMatch[0].length).match(/^\s*/)?.[0].length ?? 0;
  const headerOffset = fenceMatch[0].length + headerPadding;
  const header = opener.slice(headerOffset);

  if (parsed.titleKind === "attribute") {
    const match = header.match(/\btitle=(?:"([^"]*)"|'([^']*)')/);
    if (!match || match.index === undefined) {
      return null;
    }
    const quoteOffset = match[0].startsWith("title=\"") ? "title=\"".length : "title='".length;
    return headerOffset + match.index + quoteOffset;
  }

  return null;
}

export function footnoteDefinitionBodyOffset(raw: string): number {
  const opener = raw.slice(0, firstLineLength(raw));
  return opener.match(/^\[\^[^\]]+\]:\s*/)?.[0].length ?? 0;
}

function lineStartOffsets(lines: readonly string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

export function footnoteDefinitionRawOffsetToBodyOffset(raw: string, rawOffset: number): number {
  const lines = raw.split("\n");
  const offsets = lineStartOffsets(lines);
  const openerLength = footnoteDefinitionBodyOffset(raw);
  const target = Math.max(0, Math.min(rawOffset, raw.length));
  let bodyOffset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineStart = offsets[index] ?? 0;
    const lineEnd = lineStart + line.length;
    const contentStartInLine = index === 0
      ? openerLength
      : line.match(/^\s{2,4}/)?.[0].length ?? 0;
    const content = line.slice(contentStartInLine);
    const contentStart = lineStart + contentStartInLine;
    const contentEnd = contentStart + content.length;

    if (target <= lineEnd || index === lines.length - 1) {
      return bodyOffset + Math.max(0, Math.min(target - contentStart, content.length));
    }

    bodyOffset += content.length;
    if (index < lines.length - 1) {
      bodyOffset += 1;
    }

    if (target <= contentEnd) {
      return bodyOffset;
    }
  }

  return bodyOffset;
}

export function footnoteDefinitionBodyOffsetToRawOffset(raw: string, bodyOffset: number): number {
  const lines = raw.split("\n");
  const offsets = lineStartOffsets(lines);
  const openerLength = footnoteDefinitionBodyOffset(raw);
  let remaining = Math.max(0, bodyOffset);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const contentStartInLine = index === 0
      ? openerLength
      : line.match(/^\s{2,4}/)?.[0].length ?? 0;
    const content = line.slice(contentStartInLine);
    if (remaining <= content.length || index === lines.length - 1) {
      return (offsets[index] ?? 0) + contentStartInLine + Math.min(remaining, content.length);
    }
    remaining -= content.length;
    if (remaining > 0) {
      remaining -= 1;
    } else if (index < lines.length - 1) {
      return (offsets[index + 1] ?? raw.length);
    }
  }

  return raw.length;
}
