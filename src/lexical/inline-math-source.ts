export function stripInlineMathDelimiters(raw: string): string {
  if (raw.startsWith("\\(") && raw.endsWith("\\)")) {
    return raw.slice(2, -2);
  }
  if (raw.startsWith("$") && raw.endsWith("$")) {
    return raw.slice(1, -1);
  }
  return raw;
}
