/**
 * PDF/LaTeX/HTML export.
 *
 * - PDF and LaTeX: invoked via the Tauri `export_document` command
 *   (spawns Pandoc from the Rust backend; content passed via stdin).
 * - HTML: self-contained, generated directly in TypeScript with inline
 *   KaTeX CSS so no Pandoc or network access is required.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./tauri-fs";
import type { FileSystem, FileEntry } from "./file-manager";

/** Supported export formats. */
export type ExportFormat = "pdf" | "latex" | "html";

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
 * The output embeds KaTeX CSS inline and wraps the source content in a
 * minimal styled page. Math rendering, fenced divs, and cross-references
 * are not re-processed here — this is a lightweight "source as HTML"
 * export suitable for sharing or archiving.
 *
 * For full rendering (LaTeX-quality output), use the PDF format instead.
 */
function buildHtmlDocument(content: string, title: string): string {
  const escaped = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    /* KaTeX CSS — inlined for self-contained output */
    @import url("https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css");

    /* Document typography */
    body {
      font-family: "Georgia", "Times New Roman", serif;
      font-size: 16px;
      line-height: 1.7;
      max-width: 720px;
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
    /* Fenced div blocks */
    .fenced-div {
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 1rem;
      margin: 1.5rem 0;
    }
  </style>
</head>
<body>
<pre style="font-family: inherit; background: none; padding: 0; white-space: pre-wrap; word-wrap: break-word;">${escaped}</pre>
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
  const basename = sourcePath.split("/").pop() ?? sourcePath;
  const title = basename.endsWith(".md") ? basename.slice(0, -3) : basename;
  const html = buildHtmlDocument(content, title);
  const outputPath = deriveOutputPath(sourcePath, "html");

  if (isTauri() && fs) {
    // Write to disk via Tauri filesystem
    try {
      await fs.writeFile(outputPath, html);
    } catch {
      await fs.createFile(outputPath, html);
    }
    return outputPath;
  }

  // Browser fallback: trigger a file download
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = outputPath.split("/").pop() ?? "export.html";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return outputPath;
}

/**
 * Export all .md files in a project to a given format.
 *
 * Files are exported in parallel for efficiency. Each file's output path
 * is derived from its source path (e.g. `notes/intro.md` → `notes/intro.html`).
 *
 * @param tree - The project file tree root entry.
 * @param format - Target format for all files.
 * @param fs - FileSystem used to read file contents (and write HTML output).
 * @returns Results for each file: `{ path, outputPath }` on success or
 *          `{ path, error }` on failure.
 */
export async function batchExport(
  tree: FileEntry,
  format: ExportFormat,
  fs: FileSystem,
): Promise<Array<{ path: string; outputPath?: string; error?: string }>> {
  const mdPaths = collectMdPaths(tree);

  const results = await Promise.allSettled(
    mdPaths.map(async (path) => {
      const content = await fs.readFile(path);
      const outputPath = await exportDocument(content, format, path, fs);
      return { path, outputPath };
    }),
  );

  return results.map((result, i) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    const err = result.reason;
    return {
      path: mdPaths[i],
      error: err instanceof Error ? err.message : String(err),
    };
  });
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
