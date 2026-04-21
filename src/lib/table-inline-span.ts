/**
 * Scan an inline span inside a table row.
 *
 * Returns the index immediately after the recognised span starting at `start`,
 * or `null` when the character at `start` does not begin a special span.
 *
 * This scanner is intentionally conservative for incomplete syntax while the
 * user is typing:
 * - complete `$...$`, `\(...\)` with escaped `\|`, and code spans suppress
 *   pipe splitting
 * - incomplete `$`, `\(`, or backticks are treated as literal cell text and
 *   only consume their own opening characters
 *
 * That keeps parser-side table splitting and rich-table rediscovery aligned,
 * and prevents half-typed inline syntax from swallowing the row's real `|`
 * separators.
 */

const BACKSLASH = 92;
const DOLLAR = 36;
const BACKTICK = 96;
const OPEN_PAREN = 40;
const CLOSE_PAREN = 41;
const PIPE = 124;
const SPACE = 32;
const TAB = 9;

export interface TableCellSpan {
  readonly from: number;
  readonly to: number;
}

function isSpaceTab(ch: number): boolean {
  return ch === SPACE || ch === TAB;
}

function clampSpanEnd(text: string, end: number): number {
  return Math.min(end, text.length);
}

function canOpenDollarMath(text: string, start: number): boolean {
  if (start + 1 >= text.length) return false;
  const next = text.charCodeAt(start + 1);
  return next !== DOLLAR && !isSpaceTab(next);
}

function canCloseDollarMath(text: string, pos: number): boolean {
  if (pos <= 0) return false;
  return !isSpaceTab(text.charCodeAt(pos - 1));
}

function collectPipePositions(
  text: string,
): number[] {
  const pipes: number[] = [];
  let i = 0;
  while (i < text.length) {
    const spanEnd = scanTableInlineSpan(text, i);
    if (spanEnd !== null) {
      i = spanEnd;
    } else if (text.charCodeAt(i) === PIPE) {
      pipes.push(i);
      i++;
    } else {
      i++;
    }
  }
  return pipes;
}

export function findTablePipePositions(text: string): number[] {
  return collectPipePositions(text);
}

export function findTableCellSpans(text: string): readonly TableCellSpan[] {
  const pipes = findTablePipePositions(text);
  if (pipes.length === 0) {
    return [];
  }

  const firstPipe = pipes[0] ?? -1;
  const lastPipe = pipes[pipes.length - 1] ?? -1;
  const startsWithDelimiter = text.slice(0, firstPipe).trim().length === 0;
  const endsWithDelimiter = text.slice(lastPipe + 1).trim().length === 0;
  const spans: TableCellSpan[] = [];
  let cellFrom = startsWithDelimiter ? firstPipe + 1 : 0;

  for (const pipe of pipes) {
    if (pipe < cellFrom) {
      continue;
    }
    spans.push({ from: cellFrom, to: pipe });
    cellFrom = pipe + 1;
  }

  if (!endsWithDelimiter) {
    spans.push({ from: cellFrom, to: text.length });
  }

  return spans;
}

export function scanTableInlineSpan(
  text: string,
  start: number,
): number | null {
  if (start >= text.length) return null;
  const ch = text.charCodeAt(start);

  if (ch === BACKSLASH) {
    if (start + 1 >= text.length) return clampSpanEnd(text, start + 1);

    if (text.charCodeAt(start + 1) === OPEN_PAREN) {
      let j = start + 2;
      while (j < text.length) {
        const jch = text.charCodeAt(j);
        if (jch === BACKSLASH && j + 1 < text.length) {
          if (text.charCodeAt(j + 1) === CLOSE_PAREN) return clampSpanEnd(text, j + 2);
          j += 2;
          continue;
        }
        if (jch === PIPE) return clampSpanEnd(text, start + 2);
        j++;
      }
      return clampSpanEnd(text, start + 2);
    }

    return clampSpanEnd(text, start + 2);
  }

  if (ch === BACKTICK) {
    let tickCount = 0;
    while (start + tickCount < text.length && text.charCodeAt(start + tickCount) === BACKTICK) {
      tickCount++;
    }

    let i = start + tickCount;
    while (i < text.length) {
      if (text.charCodeAt(i) !== BACKTICK) {
        i++;
        continue;
      }

      let closeCount = 0;
      while (i + closeCount < text.length && text.charCodeAt(i + closeCount) === BACKTICK) {
        closeCount++;
      }
      if (closeCount === tickCount) {
        return clampSpanEnd(text, i + tickCount);
      }
      i += closeCount;
    }

    return clampSpanEnd(text, start + tickCount);
  }

  if (ch === DOLLAR) {
    if (start + 1 < text.length && text.charCodeAt(start + 1) === DOLLAR) {
      return null;
    }
    if (!canOpenDollarMath(text, start)) {
      return clampSpanEnd(text, start + 1);
    }

    let i = start + 1;
    while (i < text.length) {
      const next = text.charCodeAt(i);
      if (next === DOLLAR && canCloseDollarMath(text, i)) return clampSpanEnd(text, i + 1);
      if (next === BACKSLASH && i + 1 < text.length) {
        i += 2;
        continue;
      }
      i++;
    }

    return clampSpanEnd(text, start + 1);
  }

  return null;
}
