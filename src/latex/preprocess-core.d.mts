export function liftFencedDivTitles(markdown: string): string;
export function promoteLabeledDisplayMath(markdown: string): string;
export function renderMathMacros(math: Record<string, string>): string;
export function hoistMathMacros(markdown: string): string;
export function preprocessWithReadFile(
  markdown: string,
): Promise<string>;
