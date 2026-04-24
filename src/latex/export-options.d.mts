import type { FrontmatterConfig } from "../parser/frontmatter";

export const LATEX_PANDOC_FROM: string;
export const LATEX_TEMPLATE_NAMES: ReadonlySet<string>;
export const EXPORT_CONTRACT: ExportContract;

export interface ExportDependencyTool {
  readonly name: string;
  readonly version_args: readonly string[];
  readonly install_hint: string;
}

export interface ExportContract {
  readonly pandoc_from: string;
  readonly resource_path: {
    readonly entries: readonly string[];
    readonly dedupe: boolean;
  };
  readonly latex: {
    readonly templates: {
      readonly default: string;
      readonly builtins: Readonly<Record<string, string>>;
    };
    readonly args: readonly string[];
    readonly bibliography_metadata_arg: string;
    readonly pdf_args: readonly string[];
  };
  readonly html: {
    readonly args: readonly string[];
  };
  readonly dependencies: Readonly<Record<string, readonly ExportDependencyTool[]>>;
}

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
export function buildPandocResourcePath(
  projectRoot: string,
  sourceDir: string,
  options?: { readonly delimiter?: string },
): string;
export function buildHtmlPandocArgs(options: {
  readonly output: string;
  readonly resourcePath: string;
}): string[];
export function exportDependencyTools(format: string): readonly ExportDependencyTool[];
