/**
 * PDF/LaTeX/HTML export.
 *
 * - PDF and LaTeX: invoked via the Tauri `export_document` command
 *   (spawns Pandoc from the Rust backend; content passed via stdin).
 * - HTML: self-contained, generated directly in TypeScript with
 *   proper semantic HTML (headings, lists, math via KaTeX, fenced divs).
 */

import { isTauri } from "./tauri-fs";
import { measureAsync } from "./perf";
import type { FileSystem, FileEntry } from "./file-manager";
import { markdownToHtml, escapeHtml } from "./markdown-to-html";
import type { ExportFormat } from "./lib/types";
import { basename } from "./lib/utils";
import { exportThemeTokenDefaults } from "../theme-contract";
import { checkPandocCommand, exportDocumentCommand } from "./tauri-client/export";

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
 * Build a self-contained HTML document from markdown content.
 *
 * Parses the markdown and renders proper semantic HTML:
 * - Headings, paragraphs, lists (ordered, unordered, task lists)
 * - Math via KaTeX (inline and display)
 * - Fenced divs as semantic `<div class="theorem">` etc.
 * - Code blocks, blockquotes, tables, horizontal rules
 * - Inline formatting: bold, italic, strikethrough, highlight, code
 *
 * Includes a minimal stylesheet and links KaTeX CSS for math rendering.
 */
function buildHtmlDocument(content: string, title: string): string {
  const bodyHtml = markdownToHtml(content);
  const themeTokens = serializeExportThemeTokens({
    ...resolveExportThemeTokens(),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <style>
    :root {
${themeTokens}
    }
    /* Document typography */
    body {
      font-family: var(--cf-content-font);
      font-size: 16px;
      line-height: 1.7;
      max-width: 800px;
      margin: 3rem auto;
      padding: 0 1.5rem;
      color: var(--cf-fg);
      background: var(--cf-bg);
    }
    h1, h2, h3, h4, h5, h6 {
      font-family: var(--cf-ui-font);
      margin-top: 2rem;
      margin-bottom: 0.5rem;
      color: var(--cf-fg);
    }
    a {
      color: var(--cf-fg);
      text-decoration: none;
      border-bottom: 1px dotted var(--cf-muted);
    }
    .katex {
      color: inherit;
      font-size: inherit;
    }
    pre {
      font-family: var(--cf-code-font);
      background: var(--cf-hover);
      border: 1px solid var(--cf-border);
      padding: 1rem;
      overflow-x: auto;
      border-radius: 0;
    }
    code {
      font-family: var(--cf-code-font);
      font-size: 0.85em;
      background: var(--cf-hover);
      padding: 0.15em 0.35em;

      border-radius: var(--cf-border-radius);
    }
    pre code {
      background: none;
      padding: 0;
    }
    blockquote {
      margin-left: 0;
      padding-left: 1em;
      border-left: 3px solid var(--cf-blockquote-border);
      color: var(--cf-blockquote-color);
    }
    ul, ol {
      padding-left: 1.5em;
      margin: 0.8em 0;
      list-style-position: outside;
    }
    ul {
      list-style-type: disc;
    }
    ol {
      list-style-type: decimal;
    }
    li {
      display: list-item;
      margin: 0.2em 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1.5rem 0;
      font-size: var(--cf-table-font-size, 0.9em);
    }
    th, td {
      border: 1px solid var(--cf-table-border);
      padding: var(--cf-table-cell-padding);
      line-height: var(--cf-table-line-height, 1.5);
      text-align: left;
    }
    th {
      font-weight: 600;
      border-bottom: 2px solid var(--cf-table-header-border);
      background: var(--cf-subtle);
    }
    hr {
      border: none;
      border-top: 1px solid var(--cf-border);
      margin: 2rem 0;
    }
    mark {
      background: var(--cf-mark-bg);
      padding: 0.1em 0.2em;
      border-radius: var(--cf-border-radius);
    }
    .math-display {
      margin: 0.5em 0;
      text-align: center;
    }
    .math-display .katex-display {
      margin: 0;
    }
    .theorem { font-style: var(--cf-block-theorem-style); margin: var(--cf-block-margin); }
    .lemma { font-style: var(--cf-block-lemma-style); margin: var(--cf-block-margin); }
    .corollary { font-style: var(--cf-block-corollary-style); margin: var(--cf-block-margin); }
    .proposition { font-style: var(--cf-block-proposition-style); margin: var(--cf-block-margin); }
    .conjecture { font-style: var(--cf-block-conjecture-style); margin: var(--cf-block-margin); }
    .definition { font-style: var(--cf-block-definition-style); margin: var(--cf-block-margin); }
    .problem { font-style: var(--cf-block-problem-style); margin: var(--cf-block-margin); }
    .example { font-style: var(--cf-block-example-style); margin: var(--cf-block-margin); }
    .remark, .note { font-style: var(--cf-block-remark-style); margin: var(--cf-block-margin); }
    .proof {
      font-style: var(--cf-block-proof-style);
      margin: var(--cf-block-margin);
      position: relative;
    }
    .proof::after {
      content: var(--cf-proof-marker);
      color: var(--cf-proof-marker-color);
      font-size: var(--cf-proof-marker-size);
      float: right;
    }
    .div-title {
      display: var(--cf-block-title-display);
      font-weight: var(--cf-block-title-weight);
      color: var(--cf-block-title-color);
      font-style: normal;
    }
    .div-title::after {
      content: var(--cf-block-title-separator);
    }
    .cross-ref {
      color: var(--cf-fg);
      text-decoration: none;
      border-bottom: 1px dashed var(--cf-muted);
    }
    .cross-ref:hover {
      border-bottom-style: solid;
    }
    .footnote {
      font-size: 0.85em;
      color: var(--cf-muted);
      padding: 0.25rem 0;
      border-top: 1px solid var(--cf-border);
      margin-top: 0.5rem;
    }
    .math-error {
      color: var(--cf-math-error-fg);
      background: var(--cf-math-error-bg);
    }
    input[type="checkbox"] {
      margin-right: 0.4em;
    }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
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

function serializeExportThemeTokens(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([name, value]) => `      ${name}: ${value};`)
    .join("\n");
}

export const _buildHtmlDocumentForTest = buildHtmlDocument;
export const _resolveExportThemeTokensForTest = resolveExportThemeTokens;

/**
 * Export a document to PDF, LaTeX, or HTML.
 *
 * - PDF/LaTeX: requires Tauri desktop app and Pandoc.
 * - HTML: works in both browser and Tauri modes; produces a self-contained
 *   file that can be opened directly in a browser.
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
  } catch (_e) {
    // Rethrow with user-friendly message — the underlying error is opaque (command not found)
    throw new Error(
      "Pandoc is not installed or not found in PATH. " +
        "Install Pandoc from https://pandoc.org/installing.html to enable export.",
    );
  }

  const outputPath = deriveOutputPath(sourcePath, format);

  return exportDocumentCommand(content, format, outputPath);
}

/**
 * Export markdown content to a self-contained HTML file.
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
  const html = buildHtmlDocument(content, title);
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
  const mdPaths = collectMdPaths(tree);
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
  const paths: string[] = [];
  if (entry.isDirectory) {
    if (entry.children) {
      for (const child of entry.children) {
        paths.push(...collectMdPaths(child));
      }
    }
  } else if (entry.name.endsWith(".md")) {
    paths.push(entry.path);
  }
  return paths;
}
