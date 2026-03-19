/**
 * Go to Line utilities.
 *
 * Provides the `parseTarget` function for parsing "line" or "line:column"
 * strings. Used by the React GotoLineDialog component.
 */

/**
 * Parse a "line" or "line:col" string into a { line, col } object.
 * Returns null if the input is not a valid number.
 * Both line and col are 1-based.
 */
export function parseTarget(
  raw: string,
): { line: number; col: number } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(":");
  const lineNum = parseInt(parts[0], 10);
  if (!Number.isFinite(lineNum) || lineNum < 1) return null;

  const colNum = parts.length >= 2 ? parseInt(parts[1], 10) : 1;
  const col = Number.isFinite(colNum) && colNum >= 1 ? colNum : 1;

  return { line: lineNum, col };
}
