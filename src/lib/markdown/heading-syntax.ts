export interface ParsedHeadingText {
  readonly attrs?: string;
  readonly attrsFrom?: number;
  readonly attrsTo?: number;
  readonly id?: string;
  readonly labelFrom?: number;
  readonly labelTo?: number;
  readonly rawText: string;
  readonly text: string;
  readonly unnumbered: boolean;
}

export interface ParsedHeadingLine extends ParsedHeadingText {
  readonly level: number;
  readonly marker: string;
  readonly textFrom: number;
  readonly textTo: number;
}

const HEADING_RE = /^(#{1,6})[ \t]+(.+?)\s*$/;
export const HEADING_TRAILING_ATTRIBUTES_RE = /\s+(\{[^{}\n]*\})\s*$/;
const LABEL_RE = /#([A-Za-z0-9_][\w.:-]*)/;

export function extractLabelId(attrs: string | undefined): string | undefined {
  return attrs?.match(LABEL_RE)?.[1];
}

export function findTrailingHeadingAttributes(text: string): string | undefined {
  return text.match(HEADING_TRAILING_ATTRIBUTES_RE)?.[1];
}

export function hasUnnumberedHeadingAttributes(attrs: string | undefined): boolean {
  if (!attrs) {
    return false;
  }
  return /\{\s*-[^}]*\}/.test(attrs) || /\.unnumbered\b/.test(attrs);
}

export function parseHeadingText(
  rawText: string,
  textFrom = 0,
): ParsedHeadingText {
  const attrs = findTrailingHeadingAttributes(rawText);
  const attrsStart = attrs ? rawText.lastIndexOf(attrs) : -1;
  const text = (attrs ? rawText.slice(0, attrsStart) : rawText).trim();
  const id = extractLabelId(attrs);
  const labelStart = id && attrs ? attrs.indexOf(`#${id}`) : -1;

  return {
    attrs,
    attrsFrom: attrsStart >= 0 ? textFrom + attrsStart : undefined,
    attrsTo: attrsStart >= 0 && attrs ? textFrom + attrsStart + attrs.length : undefined,
    id,
    labelFrom: id && attrsStart >= 0 && labelStart >= 0
      ? textFrom + attrsStart + labelStart + 1
      : undefined,
    labelTo: id && attrsStart >= 0 && labelStart >= 0
      ? textFrom + attrsStart + labelStart + 1 + id.length
      : undefined,
    rawText,
    text,
    unnumbered: hasUnnumberedHeadingAttributes(attrs),
  };
}

export function parseHeadingLine(line: string): ParsedHeadingLine | null {
  const match = line.match(HEADING_RE);
  if (!match) {
    return null;
  }

  const marker = match[1];
  const rawText = match[2];
  if (!marker || !rawText) {
    return null;
  }

  const textFrom = line.indexOf(rawText, marker.length);
  const parsedText = parseHeadingText(rawText, textFrom);

  return {
    ...parsedText,
    level: marker.length,
    marker,
    textFrom,
    textTo: textFrom + rawText.length,
  };
}
