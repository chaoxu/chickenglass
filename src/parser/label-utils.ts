import { isWhitespace } from "./char-utils";

function containsWhitespace(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (isWhitespace(text.charCodeAt(i))) {
      return true;
    }
  }
  return false;
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
  const text = doc.slice(from, to);
  if (!text.startsWith("{#") || !text.endsWith("}")) {
    return null;
  }

  const id = text.slice(2, -1);
  if (!id || containsWhitespace(id)) {
    return null;
  }

  if (expectedPrefix && !id.startsWith(expectedPrefix)) {
    return null;
  }

  return id;
}
