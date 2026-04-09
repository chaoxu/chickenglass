export interface TrailingHeadingAttributes {
  readonly index: number;
  readonly raw: string;
  readonly content: string;
}

/**
 * Pandoc attribute token: #id, .class, key=value, key="value", or the
 * dash/unnumbered shorthand flags ({-}, {.unnumbered}).
 *
 * The regex matches sequences of these tokens separated by whitespace.
 * If the brace content does NOT consist entirely of such tokens, the braces
 * are treated as literal text (e.g. `{1,2,3}` in a math heading).
 */
const PANDOC_ATTR_TOKEN_RE =
  /^(?:#[\w:.:-]+|\.[\w-]+|\w[\w-]*="[^"]*"|\w[\w-]*=\S+|-|\.unnumbered)$/;

function isPandocAttributeContent(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length === 0) return false;
  return trimmed.split(/\s+/).every((tok) => PANDOC_ATTR_TOKEN_RE.test(tok));
}

export function findTrailingHeadingAttributes(
  text: string,
): TrailingHeadingAttributes | null {
  const match = /\s*\{([^}]*)\}\s*$/.exec(text);
  if (!match || match.index === undefined) return null;
  if (!isPandocAttributeContent(match[1])) return null;
  return {
    index: match.index,
    raw: match[0],
    content: match[1],
  };
}

export function hasUnnumberedHeadingAttributes(text: string): boolean {
  const attrs = findTrailingHeadingAttributes(text);
  return attrs !== null && /(?:^|\s)(?:-|\.unnumbered)(?=\s|$)/.test(attrs.content);
}
