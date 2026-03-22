/**
 * Shared character constants and scanning utilities for parser extensions.
 *
 * Centralises char-code constants that previously appeared as ad-hoc
 * `const` declarations scattered across highlight.ts, strikethrough.ts,
 * fenced-div.ts, fenced-div-attrs.ts, footnote.ts, equation-label.ts,
 * and math-backslash.ts.
 */

// ── Character codes ─────────────────────────────────────────────────

export const SPACE = 32;
export const TAB = 9;
export const NEWLINE = 10;
export const CR = 13;
export const DOLLAR = 36;
export const OPEN_PAREN = 40;
export const CLOSE_PAREN = 41;
export const COLON = 58;
export const EQUALS = 61;
export const OPEN_BRACKET = 91;
export const BACKSLASH = 92;
export const CLOSE_BRACKET = 93;
export const CARET = 94;
export const OPEN_BRACE = 123;
export const CLOSE_BRACE = 125;
export const TILDE = 126;

// ── Whitespace scanning ─────────────────────────────────────────────

/** Skip space and tab characters starting at `pos`. Returns the new position. */
export function skipSpaceTab(text: string, pos: number): number {
  while (
    pos < text.length &&
    (text.charCodeAt(pos) === SPACE || text.charCodeAt(pos) === TAB)
  ) {
    pos++;
  }
  return pos;
}

/** Test whether a char code is a space or tab. */
export function isSpaceTab(ch: number): boolean {
  return ch === SPACE || ch === TAB;
}

// ── Brace matching ──────────────────────────────────────────────────

/**
 * Find the end of a brace-delimited block `{...}` starting at `pos`.
 * Handles nested braces. Returns the position **after** the closing `}`
 * or -1 if the block is unterminated.
 *
 * The character at `pos` must be `{`.
 */
export function findMatchingBrace(text: string, pos: number): number {
  if (pos >= text.length || text.charCodeAt(pos) !== OPEN_BRACE) return -1;
  let depth = 1;
  let i = pos + 1;
  while (i < text.length && depth > 0) {
    const ch = text.charCodeAt(i);
    if (ch === OPEN_BRACE) depth++;
    else if (ch === CLOSE_BRACE) depth--;
    i++;
  }
  return depth === 0 ? i : -1;
}

// ── Inline delimiter scanning ───────────────────────────────────────

/**
 * Scan for a double-character inline delimiter (e.g. `==` or `~~`).
 *
 * Starting from `pos` (which should point to the first delimiter char),
 * validates the opening delimiter and scans forward for the matching
 * closing pair.
 *
 * @param cx       InlineContext (from @lezer/markdown)
 * @param pos      Position of the first delimiter character
 * @param charCode The delimiter character code (e.g. 61 for `=`, 126 for `~`)
 * @param rejectTriple If true, reject runs of 3+ delimiter chars at both open and close
 * @returns Position after the closing delimiter or -1 if no match
 */
export function scanDoubleDelimited(
  cx: { char(pos: number): number; end: number },
  pos: number,
  charCode: number,
  rejectTriple: boolean,
): { closeStart: number; closeEnd: number } | undefined {
  // Must start with two consecutive delimiter chars
  if (cx.char(pos + 1) !== charCode) return undefined;
  // Optional: reject 3+ consecutive delimiters
  if (rejectTriple && cx.char(pos + 2) === charCode) return undefined;

  let i = pos + 2;
  while (i < cx.end) {
    const ch = cx.char(i);
    if (ch === charCode && cx.char(i + 1) === charCode) {
      if (rejectTriple && cx.char(i + 2) === charCode) {
        i++;
        continue;
      }
      return { closeStart: i, closeEnd: i + 2 };
    }
    i++;
  }

  return undefined;
}
