/**
 * Scan an inline span inside a table row.
 *
 * Returns the index immediately after the recognised span starting at `start`,
 * or `null` when the character at `start` does not begin a special span.
 *
 * This scanner is intentionally conservative for incomplete syntax while the
 * user is typing:
 * - complete `$...$`, `\(...\)`, and code spans suppress pipe splitting
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

export function scanTableInlineSpan(text: string, start: number): number | null {
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

    let i = start + 1;
    while (i < text.length) {
      const next = text.charCodeAt(i);
      if (next === DOLLAR) return i + 1;
      if (next === BACKSLASH && i + 1 < text.length) {
        i += 2;
        continue;
      }
      if (next === PIPE) return start + 1;
      i++;
    }

    return start + 1;
  }

  return null;
}
