import { parse as parseYaml } from "yaml";

import exportContract from "./export-contract.json" with { type: "json" };
import { isFrontmatterDelimiterLine } from "../lib/frontmatter-delimiter.js";

export const EXPORT_CONTRACT = exportContract;
export const LATEX_PANDOC_FROM = exportContract.pandoc_from;

export const LATEX_TEMPLATE_NAMES = new Set(
  Object.keys(exportContract.latex.templates.builtins),
);

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
  } catch (_error) {
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
    template:
      stringOption(flags.template) ??
      stringOption(latex.template) ??
      exportContract.latex.templates.default,
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
  const name = template || exportContract.latex.templates.default;
  const builtinTemplate = exportContract.latex.templates.builtins[name];
  if (builtinTemplate) {
    return pathResolve(latexDir, builtinTemplate);
  }
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
  const values = {
    latex_filter_path: filterPath,
    latex_template_path: template,
    output_path: output,
    pandoc_from: exportContract.pandoc_from,
    resource_path: resourcePath,
  };
  const args = renderArgs(exportContract.latex.args, values).filter(
    (arg) => resourcePath || !arg.startsWith("--resource-path="),
  );
  const bibliographyMetadata = latexBibliographyMetadataValue(bibliography);
  if (bibliographyMetadata) {
    args.push(renderArg(exportContract.latex.bibliography_metadata_arg, {
      bibliography_metadata: bibliographyMetadata,
    }));
  }
  if (format === "pdf") {
    args.push(...exportContract.latex.pdf_args);
  }
  return args;
}

export function buildPandocResourcePath(projectRoot, sourceDir, { delimiter = ":" } = {}) {
  const pathByEntry = {
    project_root: projectRoot,
    source_dir: sourceDir,
  };
  const paths = [];
  for (const entry of exportContract.resource_path.entries) {
    const path = pathByEntry[entry];
    if (!path) {
      continue;
    }
    if (exportContract.resource_path.dedupe && paths.includes(path)) {
      continue;
    }
    paths.push(path);
  }
  return paths.join(delimiter);
}

export function buildHtmlPandocArgs({ output, resourcePath }) {
  return renderArgs(exportContract.html.args, {
    output_path: output,
    pandoc_from: exportContract.pandoc_from,
    resource_path: resourcePath,
  });
}

export function exportDependencyTools(format) {
  return exportContract.dependencies[format] ?? [];
}

function renderArgs(args, values) {
  return args.map((arg) => renderArg(arg, values));
}

function renderArg(arg, values) {
  return arg.replaceAll(/\{([a-z_]+)\}/g, (_match, key) => values[key] ?? "");
}
