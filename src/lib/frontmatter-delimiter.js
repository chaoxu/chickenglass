/** Frontmatter fence: three hyphens, optional trailing whitespace, end of line. */
export const FRONTMATTER_DELIMITER = "---";
export const FRONTMATTER_DELIMITER_PATTERN = "^---\\s*$";
export const FRONTMATTER_DELIMITER_RE = new RegExp(FRONTMATTER_DELIMITER_PATTERN);

export function isFrontmatterDelimiterLine(line) {
  return FRONTMATTER_DELIMITER_RE.test(line);
}
