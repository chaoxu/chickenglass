/**
 * PDF/LaTeX/HTML export.
 *
 * All formats are invoked via the Tauri `export_document` command, which
 * spawns Pandoc from the Rust backend and passes document content via stdin.
 */

import { resolveLatexExportOptions } from "../latex/export-options.mjs";
import { preprocessWithReadFile } from "../latex/preprocess-core.mjs";
import { isTauri } from "../lib/tauri";
import { parseFrontmatter } from "../parser/frontmatter";
import type { FileEntry, FileSystem } from "./file-manager";
import type { ExportFormat } from "./lib/types";
import { measureAsync } from "./perf";
import type { ExportDependencyCheck } from "./tauri-client/command-contract";
import { checkPandocCommand, exportDocumentCommand } from "./tauri-client/export";

export type { ExportFormat };

async function checkExportDependencies(format: ExportFormat): Promise<ExportDependencyCheck> {
  return checkPandocCommand(format);
}

function formatMissingExportDependencies(check: ExportDependencyCheck): string {
  const missing = check.tools.filter((tool) => !tool.available);
  const summary = missing.map((tool) => tool.name).join(", ");
  const hints = missing
    .map((tool) => `${tool.name}: ${tool.install_hint}`)
    .join(" ");
  return `Missing export dependencies for ${check.format} export: ${summary}. ${hints}`;
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

export const _preprocessLatexExportForTest = preprocessLatexExport;

/**
 * Export a document to PDF, LaTeX, or HTML.
 *
 * All formats require the Tauri desktop app and Pandoc. HTML export uses
 * Pandoc directly instead of Coflat's in-app preview renderer.
 *
 * @param content - The full markdown content to export.
 * @param format - Target format: "pdf", "latex", or "html".
 * @param sourcePath - Path of the source .md file (used to derive output path).
 * @param fs - Optional FileSystem used by LaTeX preprocessing helpers.
 * @returns The output file path on success.
 * @throws If not running in Tauri, if dependencies are missing, or if export fails.
 */
export async function exportDocument(
  content: string,
  format: ExportFormat,
  sourcePath: string,
  fs?: FileSystem,
): Promise<string> {
  if (!isTauri()) {
    throw new Error(
      "Export requires the Coflat desktop app. " +
        "Pandoc-backed export is not available in browser mode.",
    );
  }

  let dependencyCheck: ExportDependencyCheck;
  try {
    dependencyCheck = await checkExportDependencies(format);
  } catch (e) {
    throw new Error(
      "Could not check export dependencies before starting export.",
      { cause: e },
    );
  }
  if (!dependencyCheck.ok) {
    throw new Error(formatMissingExportDependencies(dependencyCheck));
  }

  const outputPath = deriveOutputPath(sourcePath, format);
  if (format === "html") {
    return exportDocumentCommand(content, format, outputPath, sourcePath);
  }

  const latexOptions = resolveLatexExportOptions({
    config: parseFrontmatter(content).config,
  });
  const latexContent = await preprocessLatexExport(content, sourcePath, fs);
  return exportDocumentCommand(latexContent, format, outputPath, sourcePath, latexOptions);
}

async function preprocessLatexExport(
  content: string,
  _sourcePath: string,
  _fs?: FileSystem,
): Promise<string> {
  return preprocessWithReadFile(content);
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
 * @param fs - FileSystem used to read file contents.
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
