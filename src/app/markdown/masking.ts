import { getTextLines } from "./text-lines";

function blankRange(chars: string[], from: number, to: number) {
  for (let index = from; index < to; index += 1) {
    if (chars[index] !== "\n") {
      chars[index] = " ";
    }
  }
}

function findClosingInlineCodeDelimiter(
  text: string,
  from: number,
  delimiter: string,
): number {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] !== "`") {
      continue;
    }
    let width = 1;
    while (index + width < text.length && text[index + width] === "`") {
      width += 1;
    }
    if (text.slice(index, index + width) === delimiter) {
      return index;
    }
    index += width - 1;
  }
  return -1;
}

function maskInlineCode(chars: string[], lineText: string, lineStart: number) {
  for (let index = 0; index < lineText.length; index += 1) {
    if (lineText[index] !== "`") {
      continue;
    }
    let width = 1;
    while (index + width < lineText.length && lineText[index + width] === "`") {
      width += 1;
    }
    const delimiter = lineText.slice(index, index + width);
    const closingIndex = findClosingInlineCodeDelimiter(
      lineText,
      index + width,
      delimiter,
    );
    if (closingIndex < 0) {
      index += width - 1;
      continue;
    }
    blankRange(chars, lineStart + index, lineStart + closingIndex + width);
    index = closingIndex + width - 1;
  }
}

export function maskMarkdownCodeSpansAndBlocks(doc: string): string {
  const chars = [...doc];
  const lines = getTextLines(doc);
  let openFence: { marker: "`" | "~"; length: number } | null = null;

  for (const line of lines) {
    const fenceMatch = line.text.match(/^\s*([`~]{3,})/);
    if (!openFence && fenceMatch) {
      openFence = {
        marker: fenceMatch[1][0] as "`" | "~",
        length: fenceMatch[1].length,
      };
      blankRange(chars, line.start, line.end);
      continue;
    }

    if (openFence) {
      blankRange(chars, line.start, line.end);
      const closingPattern = new RegExp(`^\\s*${openFence.marker}{${openFence.length},}\\s*$`);
      if (closingPattern.test(line.text)) {
        openFence = null;
      }
      continue;
    }

    maskInlineCode(chars, line.text, line.start);
  }

  return chars.join("");
}
