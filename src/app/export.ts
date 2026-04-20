/**
 * PDF/LaTeX export plus a hidden HTML source snapshot helper.
 *
 * - PDF and LaTeX: invoked via the Tauri `export_document` command
 *   (spawns Pandoc from the Rust backend; content passed via stdin).
 * - HTML: not a user-facing export surface. The helper below preserves the
 *   old source-in-`pre` snapshot path for tests/future work only.
 */

import { isTauri } from "../lib/tauri";
import { parseFrontmatter } from "../lib/frontmatter";
import {
  normalizeProjectPath,
  resolveProjectPathFromDocument,
} from "../lib/project-paths";
import { resolveLatexExportOptions } from "../latex/export-options.mjs";
import { preprocessWithReadFile } from "../latex/preprocess-core.mjs";
import { measureAsync } from "./perf";
import type { FileSystem, FileEntry } from "./file-manager";
import type { ExportFormat } from "./lib/types";
import { basename } from "./lib/utils";
import { exportThemeTokenDefaults } from "../theme-contract";
import { checkPandocCommand, exportDocumentCommand } from "./tauri-client/export";
import { collectMarkdownPathsFromTree, listAllMarkdownFiles } from "./project-file-enumerator";

export type { ExportFormat };


/** Check whether Pandoc is installed. Returns the version string on success. */
async function checkPandoc(): Promise<string> {
  return checkPandocCommand();
}

/**
 * Derive the output path from the source file path and desired format.
 *
 * Replaces the `.md` extension with the format's extension.
 * If the path has no `.md` extension, appends the format extension.
 */
function deriveOutputPath(sourcePath: string, format: ExportFormat): string {
  const extMap: Record<ExportFormat, string> = {
    pdf: ".pdf",
    latex: ".tex",
    html: ".html",
  };
  const ext = extMap[format];
  if (sourcePath.endsWith(".md")) {
    return sourcePath.slice(0, -3) + ext;
  }
  return sourcePath + ext;
}

/**
 * Build a source snapshot HTML document from markdown content.
 *
 * This intentionally does not claim semantic markdown rendering. HTML export
 * is hidden from product UI until a real supported exporter exists.
 */
function buildHtmlDocument(
  content: string,
  title: string,
): string {
  const themeTokens = serializeExportThemeTokens({
    ...resolveExportThemeTokens(),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
${themeTokens}
    }
    body {
      font-family: var(--cf-content-font);
      font-size: var(--cf-base-font-size);
      line-height: var(--cf-line-height);
      max-width: var(--cf-content-max-width);
      margin: 3rem auto;
      padding: 0 1.5rem;
      color: var(--cf-fg);
      background: var(--cf-bg);
    }
    .cf-markdown-source {
      font-family: var(--cf-code-font);
      background: var(--cf-hover);
      border: 1px solid var(--cf-border);
      padding: 1rem;
      overflow-x: auto;
      white-space: pre-wrap;
      border-radius: var(--cf-border-radius);
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <pre class="cf-markdown-source">${escapeHtml(content)}</pre>
</body>
</html>`;
}

async function buildHtmlDocumentWithResolvedImages(
  content: string,
  title: string,
  _fs?: FileSystem,
  _documentPath = "",
): Promise<string> {
  return buildHtmlDocument(content, title);
}

function resolveExportThemeTokens(): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [name, fallback] of Object.entries(exportThemeTokenDefaults)) {
    tokens[name] = resolveExportCssValue(name, fallback);
  }
  return tokens;
}

function resolveExportCssValue(variableName: string, fallback: string): string {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function") {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variableName)
    .trim();
  return value || fallback;
}

/**
 * Sanitize a CSS value for safe interpolation inside a `<style>` block.
 *
 * Strips any `</style...>` sequence (case-insensitive) to prevent an attacker
 * from closing the style element and injecting arbitrary HTML. The regex
 * matches the full closing tag: `</style` + optional whitespace/attributes + `>`.
 */
export function sanitizeCssValue(value: string): string {
  // Remove </style> closing tags (case-insensitive) that could close the style block.
  // Matches </style followed by optional whitespace/attributes and the closing >.
  return value.replace(/<\/style\s*[^>]*>/gi, "");
}

function serializeExportThemeTokens(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([name, value]) => `      ${name}: ${sanitizeCssValue(value)};`)
    .join("\n");
}

export const _buildHtmlDocumentForTest = buildHtmlDocument;
export const _buildHtmlDocumentAsyncForTest = buildHtmlDocumentWithResolvedImages;
export const _resolveExportThemeTokensForTest = resolveExportThemeTokens;
export const _preprocessLatexExportForTest = preprocessLatexExport;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Export a document to PDF, LaTeX, or the hidden HTML source snapshot.
 *
 * - PDF/LaTeX: requires Tauri desktop app and Pandoc.
 * - HTML: internal/hidden source snapshot path retained for tests and future
 *   exporter work; it is not exposed as a supported product surface.
 *
 * @param content - The full markdown content to export (with includes expanded).
 * @param format - Target format: "pdf", "latex", or "html".
 * @param sourcePath - Path of the source .md file (used to derive output path).
 * @param fs - FileSystem to write the HTML output (only needed for "html" format).
 * @returns The output file path on success.
 * @throws If not running in Tauri for pdf/latex, if Pandoc is missing, or if export fails.
 */
export async function exportDocument(
  content: string,
  format: ExportFormat,
  sourcePath: string,
  fs?: FileSystem,
): Promise<string> {
  if (format === "html") {
    return exportHtml(content, sourcePath, fs);
  }

  // PDF and LaTeX require Tauri + Pandoc
  if (!isTauri()) {
    throw new Error(
      "Export requires the Coflat desktop app. " +
        "PDF/LaTeX export is not available in browser mode.",
    );
  }

  // Check that Pandoc is available
  try {
    await checkPandoc();
  } catch (e) {
    throw new Error(
      "Pandoc is not installed or not found in PATH. " +
        "Install Pandoc from https://pandoc.org/installing.html to enable export.",
      { cause: e },
    );
  }

  const outputPath = deriveOutputPath(sourcePath, format);
  const latexOptions = resolveLatexExportOptions({
    config: parseFrontmatter(content).config,
  });
  const latexContent = await preprocessLatexExport(content, sourcePath, fs);

  return exportDocumentCommand(latexContent, format, outputPath, sourcePath, latexOptions);
}

async function preprocessLatexExport(
  content: string,
  sourcePath: string,
  fs?: FileSystem,
): Promise<string> {
  return preprocessWithReadFile(content, sourcePath, {
    pathKey: normalizeProjectPath,
    readFile: async (path: string) => {
      if (!fs) {
        throw new Error(
          `Cannot resolve LaTeX include "${path}" without a project filesystem.`,
        );
      }
      return fs.readFile(path);
    },
    resolvePath: resolveProjectPathFromDocument,
  });
}

/**
 * Export markdown content to a source-snapshot HTML file.
 *
 * In Tauri mode the file is written to disk via the filesystem backend.
 * In browser mode the file is offered as a download via the browser's
 * Blob/URL download mechanism (no filesystem access required).
 *
 * @param content - Markdown source content.
 * @param sourcePath - Path of the source .md file (used to derive the output path).
 * @param fs - FileSystem to write the output (only used in Tauri mode).
 * @returns The output path (absolute in Tauri, derived name in browser).
 */
async function exportHtml(
  content: string,
  sourcePath: string,
  fs?: FileSystem,
): Promise<string> {
  const name = basename(sourcePath);
  const title = name.endsWith(".md") ? name.slice(0, -3) : name;
  const html = await buildHtmlDocumentWithResolvedImages(content, title, fs, sourcePath);
  const outputPath = deriveOutputPath(sourcePath, "html");

  if (isTauri() && fs) {
    // Write to disk via Tauri filesystem
    try {
      await fs.writeFile(outputPath, html);
    } catch (_e) {
      // best-effort: writeFile fails if the file doesn't exist yet — fall back to createFile
      await fs.createFile(outputPath, html);
    }
    return outputPath;
  }

  // Browser fallback: trigger a file download
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = basename(outputPath);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return outputPath;
}

/** Progress callback for batch export operations. */
export type BatchExportProgress = (completed: number, total: number, currentPath: string) => void;

/**
 * Export all .md files in a project to a given format.
 *
 * Files are exported sequentially to allow progress reporting without
 * blocking the UI (each iteration yields to the event loop via await).
 *
 * @param tree - The project file tree root entry.
 * @param format - Target format for all files.
 * @param fs - FileSystem used to read file contents (and write HTML output).
 * @param onProgress - Optional callback invoked after each file is exported.
 * @returns Results for each file: `{ path, outputPath }` on success or
 *          `{ path, error }` on failure.
 */
export async function batchExport(
  tree: FileEntry,
  format: ExportFormat,
  fs: FileSystem,
  onProgress?: BatchExportProgress,
): Promise<Array<{ path: string; outputPath?: string; error?: string }>> {
  const mdPaths = await listAllMarkdownFiles({
    root: tree,
    listChildren: fs.listChildren?.bind(fs),
  });
  const results: Array<{ path: string; outputPath?: string; error?: string }> = [];

  for (let i = 0; i < mdPaths.length; i++) {
    const path = mdPaths[i];
    try {
      const content = await fs.readFile(path);
      const outputPath = await measureAsync("export.batch_item", () => exportDocument(content, format, path, fs), {
        category: "export",
        detail: path,
      });
      results.push({ path, outputPath });
    } catch (err: unknown) {
      results.push({
        path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    onProgress?.(i + 1, mdPaths.length, path);
  }

  return results;
}

/** Recursively collect all .md file paths from a FileEntry tree. */
export function collectMdPaths(entry: FileEntry): string[] {
  return collectMarkdownPathsFromTree(entry);
}
