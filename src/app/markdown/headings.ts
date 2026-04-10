import { getTextLines } from "./text-lines";

export interface HeadingEntry {
  readonly level: number;
  readonly text: string;
  readonly number: string;
  readonly pos: number;
  readonly id?: string;
}

export interface HeadingDefinition extends HeadingEntry {
  readonly from: number;
  readonly to: number;
  readonly attrs?: string;
  readonly labelFrom?: number;
  readonly labelTo?: number;
}

const HEADING_RE = /^(#{1,6})[ \t]+(.+?)\s*$/;
const TRAILING_ATTRIBUTES_RE = /\s+(\{[^{}\n]*\})\s*$/;
const LABEL_RE = /#([A-Za-z0-9_][\w.:-]*)/;

export function findTrailingHeadingAttributes(text: string): string | undefined {
  return text.match(TRAILING_ATTRIBUTES_RE)?.[1];
}

export function hasUnnumberedHeadingAttributes(attrs: string | undefined): boolean {
  if (!attrs) {
    return false;
  }
  return /\{\s*-[^}]*\}/.test(attrs) || /\.unnumbered\b/.test(attrs);
}

export function extractHeadingDefinitions(
  doc: string,
  scanDoc = doc,
): HeadingDefinition[] {
  const lines = getTextLines(doc);
  const scanLines = getTextLines(scanDoc);
  const counters = [0, 0, 0, 0, 0, 0];
  const headings: HeadingDefinition[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const scanLine = scanLines[index];
    const match = scanLine.text.match(HEADING_RE);
    if (!match) {
      continue;
    }

    const level = match[1].length;
    const rawText = match[2];
    const attrs = findTrailingHeadingAttributes(rawText);
    const text = (attrs
      ? rawText.slice(0, rawText.lastIndexOf(attrs))
      : rawText
    ).trim();
    const unnumbered = hasUnnumberedHeadingAttributes(attrs);

    if (!unnumbered) {
      counters[level - 1] += 1;
      for (let index = level; index < counters.length; index += 1) {
        counters[index] = 0;
      }
    }

    const number = unnumbered
      ? ""
      : counters.slice(0, level).filter((value) => value > 0).join(".");
    const id = attrs?.match(LABEL_RE)?.[1];
    const attrsStart = attrs ? line.text.lastIndexOf(attrs) : -1;
    const labelStart = id && attrs ? attrs.indexOf(`#${id}`) : -1;

    headings.push({
      level,
      text,
      number,
      pos: line.start,
      id,
      from: line.start,
      to: line.end,
      attrs,
      labelFrom: id && attrsStart >= 0 && labelStart >= 0
        ? line.start + attrsStart + labelStart + 1
        : undefined,
      labelTo: id && attrsStart >= 0 && labelStart >= 0
        ? line.start + attrsStart + labelStart + 1 + id.length
        : undefined,
    });
  }

  return headings;
}

export function extractHeadingsFromMarkdown(doc: string): HeadingEntry[] {
  return extractHeadingDefinitions(doc).map(({ level, text, number, pos, id }) => ({
    level,
    text,
    number,
    pos,
    id,
  }));
}

export function headingAncestryAt(
  headings: ReadonlyArray<HeadingEntry>,
  cursorPos: number,
): HeadingEntry[] {
  const before = headings.filter((heading) => heading.pos <= cursorPos);
  if (before.length === 0) {
    return [];
  }

  const ancestry: HeadingEntry[] = [];
  let currentLevel = Infinity;

  for (let index = before.length - 1; index >= 0; index -= 1) {
    const heading = before[index];
    if (heading.level < currentLevel) {
      ancestry.unshift(heading);
      currentLevel = heading.level;
      if (currentLevel === 1) {
        break;
      }
    }
  }

  return ancestry;
}

export function activeHeadingIndex(
  headings: ReadonlyArray<HeadingEntry>,
  cursorPos: number,
): number {
  for (let index = headings.length - 1; index >= 0; index -= 1) {
    if (headings[index].pos <= cursorPos) {
      return index;
    }
  }
  return -1;
}
