export interface TextLine {
  readonly number: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface TextPosition {
  readonly line: number;
  readonly col: number;
}

let cachedDoc = "";
let cachedLines: TextLine[] | null = null;

export function getTextLines(doc: string): TextLine[] {
  if (cachedLines && doc === cachedDoc) {
    return cachedLines;
  }

  const rawLines = doc.split("\n");
  const lines: TextLine[] = [];
  let offset = 0;

  for (let index = 0; index < rawLines.length; index += 1) {
    const text = rawLines[index];
    lines.push({
      number: index + 1,
      start: offset,
      end: offset + text.length,
      text,
    });
    offset += text.length + 1;
  }

  cachedDoc = doc;
  cachedLines = lines;
  return lines;
}

export function getTextPosition(doc: string, pos: number): TextPosition {
  const clamped = Math.max(0, Math.min(pos, doc.length));
  const lines = getTextLines(doc);

  for (const line of lines) {
    if (clamped <= line.end || line.number === lines.length) {
      return {
        line: line.number,
        col: clamped - line.start + 1,
      };
    }
  }

  return { line: 1, col: 1 };
}

export function getTextLineAtOffset(doc: string, pos: number): TextLine {
  const clamped = Math.max(0, Math.min(pos, doc.length));
  const lines = getTextLines(doc);

  for (const line of lines) {
    if (clamped <= line.end || line.number === lines.length) {
      return line;
    }
  }

  return {
    number: 1,
    start: 0,
    end: 0,
    text: "",
  };
}

export function getOffsetForLineAndColumn(
  doc: string,
  lineNumber: number,
  column = 1,
): number {
  const lines = getTextLines(doc);
  if (lines.length === 0) {
    return 0;
  }

  const lineIndex = Math.max(0, Math.min(lineNumber - 1, lines.length - 1));
  const line = lines[lineIndex];
  const columnOffset = Math.max(0, Math.min(column - 1, line.text.length));
  return line.start + columnOffset;
}
