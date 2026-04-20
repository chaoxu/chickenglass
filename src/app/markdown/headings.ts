import { getTextLines } from "./text-lines";
import {
  parseHeadingLine,
  type ParsedHeadingLine,
} from "./heading-syntax";

export {
  extractLabelId,
  findTrailingHeadingAttributes,
  hasUnnumberedHeadingAttributes,
  parseHeadingLine,
  parseHeadingText,
} from "./heading-syntax";

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
    const scanHeading = parseHeadingLine(scanLine.text);
    if (!scanHeading) {
      continue;
    }

    const heading: ParsedHeadingLine = parseHeadingLine(line.text) ?? scanHeading;
    const { attrs, id, level, text, unnumbered } = heading;

    if (!unnumbered) {
      counters[level - 1] += 1;
      for (let index = level; index < counters.length; index += 1) {
        counters[index] = 0;
      }
    }

    const number = unnumbered
      ? ""
      : counters.slice(0, level).filter((value) => value > 0).join(".");
    headings.push({
      level,
      text,
      number,
      pos: line.start,
      id,
      from: line.start,
      to: line.end,
      attrs,
      labelFrom: heading.labelFrom !== undefined
        ? line.start + heading.labelFrom
        : undefined,
      labelTo: heading.labelTo !== undefined
        ? line.start + heading.labelTo
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

export function headingEntriesEqual(
  a: ReadonlyArray<HeadingEntry>,
  b: ReadonlyArray<HeadingEntry>,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].pos !== b[i].pos ||
      a[i].level !== b[i].level ||
      a[i].text !== b[i].text ||
      a[i].number !== b[i].number ||
      a[i].id !== b[i].id
    ) return false;
  }
  return true;
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
