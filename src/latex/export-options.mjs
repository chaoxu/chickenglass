import { parse as parseYaml } from "yaml";

import { isFrontmatterDelimiterLine } from "../lib/frontmatter-delimiter.js";

export const LATEX_PANDOC_FROM =
  "markdown+fenced_divs+raw_tex+grid_tables+pipe_tables+tex_math_dollars+tex_math_single_backslash";

export const LATEX_TEMPLATE_NAMES = new Set(["article", "lipics"]);

export function parseLatexFrontmatterConfig(markdown) {
  const lines = markdown.split("\n");
  if (!isFrontmatterDelimiterLine(lines[0] ?? "")) {
    return {};
  }
  const closeIndex = lines.findIndex((line, index) => index > 0 && isFrontmatterDelimiterLine(line));
  if (closeIndex < 0) {
    return {};
  }
  let parsed;
  try {
    parsed = parseYaml(lines.slice(1, closeIndex).join("\n"));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const config = {};
  if (typeof parsed.bibliography === "string") {
    config.bibliography = parsed.bibliography;
  }
  if (parsed.latex && typeof parsed.latex === "object" && !Array.isArray(parsed.latex)) {
    const latex = {};
    if (typeof parsed.latex.template === "string") {
      latex.template = parsed.latex.template;
    }
    if (typeof parsed.latex.bibliography === "string") {
      latex.bibliography = parsed.latex.bibliography;
    }
    if (Object.keys(latex).length > 0) {
      config.latex = latex;
    }
  }
  return config;
}

export function resolveLatexExportOptions({ config = {}, flags = {} } = {}) {
  const latex = config.latex && typeof config.latex === "object" ? config.latex : {};
  return {
    bibliography:
      stringOption(flags.bibliography) ??
      stringOption(latex.bibliography) ??
      stringOption(config.bibliography),
    template: stringOption(flags.template) ?? stringOption(latex.template) ?? "article",
  };
}

function stringOption(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isAbsolutePath(path) {
  return /^(?:\/|[A-Za-z]:[\\/])/.test(path);
}

function defaultResolvePath(base, path) {
  if (isAbsolutePath(path)) {
    return path;
  }
  return [base, path].filter(Boolean).join("/").replace(/\/+/g, "/");
}

export function resolveLatexTemplatePath(template, { cwd = "", latexDir, pathResolve = defaultResolvePath } = {}) {
  const name = template || "article";
  if (name === "article") return pathResolve(latexDir, "template/article.tex");
  if (name === "lipics") return pathResolve(latexDir, "template/lipics.tex");
  return pathResolve(cwd, name);
}

export function latexBibliographyMetadataValue(bibliography) {
  if (!bibliography) {
    return null;
  }
  const fileName = bibliography.split(/[\\/]/).pop() ?? bibliography;
  return fileName.endsWith(".bib") ? fileName.slice(0, -4) : fileName;
}

export function buildLatexPandocArgs({
  bibliography,
  filterPath,
  format = "latex",
  output,
  resourcePath,
  template,
}) {
  const args = [
    `--from=${LATEX_PANDOC_FROM}`,
    "--to=latex",
    "--wrap=preserve",
    "--syntax-highlighting=none",
    `--lua-filter=${filterPath}`,
    `--template=${template}`,
  ];
  if (resourcePath) {
    args.push(`--resource-path=${resourcePath}`);
  }
  args.push(`--output=${output}`);
  const bibliographyMetadata = latexBibliographyMetadataValue(bibliography);
  if (bibliographyMetadata) {
    args.push(`--metadata=bibliography=${bibliographyMetadata}`);
  }
  if (format === "pdf") {
    args.push("--pdf-engine=xelatex");
  }
  return args;
}
