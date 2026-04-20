export const FRONTMATTER_DELIMITER: "---";
export const FRONTMATTER_DELIMITER_PATTERN: "^---\\s*$";
export const FRONTMATTER_DELIMITER_RE: RegExp;
export function isFrontmatterDelimiterLine(line: string): boolean;
