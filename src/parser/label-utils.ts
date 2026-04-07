import { COLON, isIdentChar } from "./char-utils";

function isLabelStartChar(ch: number): boolean {
  return (
    (ch >= 65 && ch <= 90) ||
    (ch >= 97 && ch <= 122) ||
    (ch >= 48 && ch <= 57) ||
    ch === 95
  );
}

/**
 * Parse a Pandoc-style braced id like `{#eq:foo}`.
 *
 * When `expectedPrefix` is provided, the id must start with that prefix and
 * its suffix must begin with an identifier-start character.
 */
export function parseBracedId(
  text: string,
  expectedPrefix?: string,
): string | null {
  if (!text.startsWith("{#") || !text.endsWith("}")) {
    return null;
  }

  const id = text.slice(2, -1);
  if (!id || !isLabelStartChar(id.charCodeAt(0))) {
    return null;
  }

  for (let i = 1; i < id.length; i++) {
    if (!isIdentChar(id.charCodeAt(i))) {
      return null;
    }
  }

  if (!expectedPrefix) {
    return id;
  }

  if (!id.startsWith(expectedPrefix)) {
    return null;
  }

  const suffix = id.slice(expectedPrefix.length);
  if (!suffix || !isLabelStartChar(suffix.charCodeAt(0))) {
    return null;
  }

  for (let i = 1; i < suffix.length; i++) {
    if (suffix.charCodeAt(i) === COLON) {
      return null;
    }
  }

  return id;
}

/**
 * Read a Pandoc-style braced label like `{#eq:foo}` from a document slice.
 *
 * The caller is expected to pass the range of a syntax node that already
 * represents a label-like construct (for example, EquationLabel).
 */
export function readBracedLabelId(
  doc: string,
  from: number,
  to: number,
  expectedPrefix?: string,
): string | null {
  return parseBracedId(doc.slice(from, to), expectedPrefix);
}
