export function renderMathMacros(math: Record<string, string>): string;
export function hoistMathMacros(markdown: string): string;
export function preprocessWithReadFile(
  markdown: string,
  sourcePath?: string,
  options?: unknown,
): Promise<string>;
