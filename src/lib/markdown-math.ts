import { findNextInlineMathSource } from "./inline-math-source";

export function containsMarkdownMath(text: string): boolean {
  return findNextInlineMathSource(text, 0, { requireTightDollar: true }) !== null;
}
