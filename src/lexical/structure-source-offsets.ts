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

  if (parsed.titleKind === "implicit") {
    return headerOffset;
  }

  if (parsed.titleKind === "trailing") {
    const attrsEnd = header.indexOf("}");
    const trailingRawOffset = attrsEnd >= 0 ? attrsEnd + 1 : 0;
    const leading = header.slice(trailingRawOffset).match(/^\s*/)?.[0].length ?? 0;
    return headerOffset + trailingRawOffset + leading;
  }

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
