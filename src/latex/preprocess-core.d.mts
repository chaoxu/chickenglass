export interface PreprocessIncludeOptions {
  readonly pathKey?: (path: string) => string;
  readonly readFile: (path: string) => Promise<string>;
  readonly resolvePath: (sourcePath: string, targetPath: string) => string;
}

export function liftFencedDivTitles(markdown: string): string;
export function stripFrontmatter(source: string): string;
export function resolveIncludesWithReadFile(
  markdown: string,
  sourcePath: string,
  options: PreprocessIncludeOptions,
): Promise<string>;
export function promoteLabeledDisplayMath(markdown: string): string;
export function renderMathMacros(math: Record<string, string>): string;
export function hoistMathMacros(markdown: string): string;
export function preprocessWithReadFile(
  markdown: string,
  sourcePath: string,
  options: PreprocessIncludeOptions,
): Promise<string>;
