export function containsMarkdownMath(text: string): boolean {
  return /(^|[^\\])(?:\$(?!\s)[^$\n]+(?<!\s)\$|\\\([^)]+\\\))/.test(text);
}
