import type { FrontmatterConfig } from "../parser/frontmatter";

export const LATEX_PANDOC_FROM: string;
export const LATEX_TEMPLATE_NAMES: ReadonlySet<string>;

export interface LatexExportFlags {
  readonly bibliography?: unknown;
  readonly template?: unknown;
}

export interface ResolvedLatexExportOptions {
  readonly bibliography?: string;
  readonly template: string;
}

export interface BuildLatexPandocArgsOptions {
  readonly bibliography?: string;
  readonly filterPath: string;
  readonly format?: "latex" | "pdf";
  readonly output: string;
  readonly resourcePath?: string;
  readonly template: string;
}

export function parseLatexFrontmatterConfig(markdown: string): FrontmatterConfig;
export function resolveLatexExportOptions(options?: {
  readonly config?: FrontmatterConfig;
  readonly flags?: LatexExportFlags;
}): ResolvedLatexExportOptions;
export function resolveLatexTemplatePath(
  template: string | undefined,
  options: {
    readonly cwd?: string;
    readonly latexDir: string;
    readonly pathResolve?: (base: string, path: string) => string;
  },
): string;
export function latexBibliographyMetadataValue(bibliography: string | undefined): string | null;
export function buildLatexPandocArgs(options: BuildLatexPandocArgsOptions): string[];
