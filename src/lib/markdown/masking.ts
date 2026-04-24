import { getTextLines } from "./text-lines";
import { findNextInlineMathSource } from "../inline-math-source";
import { collectSourceBlockRanges } from "./block-scanner";

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

function maskDisplayMath(chars: string[], doc: string) {
  for (const range of collectSourceBlockRanges(doc)) {
    if (range.variant === "display-math") {
      blankRange(chars, range.from, range.to);
    }
  }
}

function maskInlineMath(chars: string[], doc: string) {
  for (const line of getTextLines(doc)) {
    let start = 0;
    for (;;) {
      const parsed = findNextInlineMathSource(line.text, start, {
        requireTightDollar: true,
      });
      if (!parsed) {
        break;
      }

      const from = line.start + parsed.from;
      const to = line.start + parsed.to;
      if (
        parsed.delimiter === "dollar"
        && (doc[from - 1] === "$" || doc[to] === "$")
      ) {
        start = parsed.from + 1;
        continue;
      }

      blankRange(chars, from, to);
      start = parsed.to;
    }
  }
}

function findInlineLinkDestinationEnd(doc: string, from: number): number {
  let depth = 0;
  for (let index = from; index < doc.length; index += 1) {
    const char = doc[index];
    if (char === "\n") {
      return -1;
    }
    if (char === "\\" && index + 1 < doc.length) {
      index += 1;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      if (depth === 0) {
        return index;
      }
      depth -= 1;
    }
  }
  return -1;
}

function isEscaped(doc: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (doc[cursor] !== "\\") {
      break;
    }
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findInlineLinkLabelStart(doc: string, closeLabel: number): number {
  let depth = 0;
  for (let index = closeLabel - 1; index >= 0; index -= 1) {
    const char = doc[index];
    if (char === "\n") {
      return -1;
    }
    if (isEscaped(doc, index)) {
      continue;
    }
    if (char === "]") {
      depth += 1;
      continue;
    }
    if (char === "[") {
      if (depth === 0) {
        return doc[index - 1] === "!" ? index - 1 : index;
      }
      depth -= 1;
    }
  }
  return -1;
}

function maskInlineLinks(chars: string[], doc: string) {
  for (let index = 0; index < doc.length - 1; index += 1) {
    if (doc[index] !== "]" || doc[index + 1] !== "(" || isEscaped(doc, index)) {
      continue;
    }

    const labelFrom = findInlineLinkLabelStart(doc, index);
    if (labelFrom < 0) {
      continue;
    }

    const destinationFrom = index + 2;
    const destinationTo = findInlineLinkDestinationEnd(doc, destinationFrom);
    if (destinationTo < 0) {
      continue;
    }

    blankRange(chars, labelFrom, destinationTo + 1);
    index = destinationTo;
  }
}

export function maskMarkdownReferenceScanTargets(doc: string): string {
  const masked = maskMarkdownCodeSpansAndBlocks(doc);
  const chars = [...masked];
  maskDisplayMath(chars, masked);
  maskInlineMath(chars, masked);
  maskInlineLinks(chars, masked);
  return chars.join("");
}
