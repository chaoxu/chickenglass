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

function isSpaceTab(ch: number): boolean {
  return ch === SPACE || ch === TAB;
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

export function scanTableInlineSpan(
  text: string,
  start: number,
): number | null {
  const ch = text.charCodeAt(start);

  if (ch === BACKSLASH) {
    if (start + 1 >= text.length) return start + 1;

    if (text.charCodeAt(start + 1) === OPEN_PAREN) {
      let j = start + 2;
      while (j < text.length) {
        const jch = text.charCodeAt(j);
        if (jch === BACKSLASH && j + 1 < text.length) {
          if (text.charCodeAt(j + 1) === CLOSE_PAREN) return j + 2;
          j += 2;
          continue;
        }
        if (jch === PIPE) return start + 2;
        j++;
      }
      return start + 2;
    }

    return Math.min(start + 2, text.length);
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
        return i + tickCount;
      }
      i += closeCount;
    }

    return start + tickCount;
  }

  if (ch === DOLLAR) {
    if (start + 1 < text.length && text.charCodeAt(start + 1) === DOLLAR) {
      return null;
    }
    if (!canOpenDollarMath(text, start)) {
      return start + 1;
    }

    let i = start + 1;
    while (i < text.length) {
      const next = text.charCodeAt(i);
      if (next === DOLLAR && canCloseDollarMath(text, i)) return i + 1;
      if (next === BACKSLASH && i + 1 < text.length) {
        i += 2;
        continue;
      }
      i++;
    }

    return start + 1;
  }

  return null;
}
