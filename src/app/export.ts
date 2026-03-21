/**
 * PDF/LaTeX/HTML export.
 *
 * - PDF and LaTeX: invoked via the Tauri `export_document` command
 *   (spawns Pandoc from the Rust backend; content passed via stdin).
 * - HTML: self-contained, generated directly in TypeScript with
 *   proper semantic HTML (headings, lists, math via KaTeX, fenced divs).
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./tauri-fs";
import type { FileSystem, FileEntry } from "./file-manager";
import { markdownToHtml, escapeHtml } from "./markdown-to-html";
import type { ExportFormat } from "./lib/types";
import { basename } from "./lib/utils";

export type { ExportFormat };

/** Check whether Pandoc is installed. Returns the version string on success. */
export async function checkPandoc(): Promise<string> {
  return invoke<string>("check_pandoc");
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <style>
    /* Document typography */
    body {
      font-family: "Georgia", "Times New Roman", serif;
      font-size: 16px;
      line-height: 1.7;
      max-width: 800px;
      margin: 3rem auto;
      padding: 0 1.5rem;
      color: #111;
      background: #fff;
    }
    h1, h2, h3, h4, h5, h6 {
      font-family: sans-serif;
      margin-top: 2rem;
      margin-bottom: 0.5rem;
    }
    pre {
      background: #f4f4f4;
      padding: 1rem;
      overflow-x: auto;
      border-radius: 4px;
    }
    code {
      font-family: "Fira Code", "Consolas", monospace;
      font-size: 0.9em;
      background: #f4f4f4;
      padding: 0.1em 0.3em;
      border-radius: 3px;
    }
    pre code {
      background: none;
      padding: 0;
    }
    blockquote {
      margin-left: 0;
      padding-left: 1.5rem;
      border-left: 3px solid #ccc;
      color: #555;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1.5rem 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 0.5rem 0.75rem;
    }
    th {
      background: #f8f8f8;
      font-weight: 600;
    }
    hr {
      border: none;
      border-top: 1px solid #ddd;
      margin: 2rem 0;
    }
    mark {
      background: #fff3a3;
      padding: 0.1em 0.2em;
    }
    .math-display {
      margin: 1.5rem 0;
      text-align: center;
    }
    /* Fenced div blocks (theorem, proof, lemma, etc.) */
    .theorem, .lemma, .corollary, .definition, .proposition, .conjecture, .problem {
      border-left: 3px solid #4a9eff;
      padding: 0.75rem 1rem;
      margin: 1.5rem 0;
      background: #f7faff;
    }
    .proof {
      border-left: 3px solid #888;
      padding: 0.75rem 1rem;
      margin: 1.5rem 0;
      background: #fafafa;
    }
    .remark, .example, .note {
      border-left: 3px solid #e8a838;
      padding: 0.75rem 1rem;
      margin: 1.5rem 0;
      background: #fffdf5;
    }
    .div-title {
      display: block;
      margin-bottom: 0.5rem;
    }
    .cross-ref {
      color: #4a9eff;
      text-decoration: none;
      border-bottom: 1px dashed #4a9eff;
    }
    .cross-ref:hover {
      border-bottom-style: solid;
    }
    .footnote {
      font-size: 0.9em;
      color: #555;
      padding: 0.25rem 0;
      border-top: 1px solid #eee;
      margin-top: 0.5rem;
    }
    .math-error {
      color: #c00;
      background: #fff0f0;
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
      "Export requires the Chickenglass desktop app. " +
        "PDF/LaTeX export is not available in browser mode.",
    );
  }

  // Check that Pandoc is available
  try {
    await checkPandoc();
  } catch {
    throw new Error(
      "Pandoc is not installed or not found in PATH. " +
        "Install Pandoc from https://pandoc.org/installing.html to enable export.",
    );
  }

  const outputPath = deriveOutputPath(sourcePath, format);

  const result = await invoke<string>("export_document", {
    content,
    format,
    outputPath,
  });

  return result;
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
    } catch {
      // writeFile fails if the file doesn't exist yet — fall back to createFile
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
      const outputPath = await exportDocument(content, format, path, fs);
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
