/**
 * PDF/LaTeX export via Pandoc.
 *
 * Invokes the Tauri `export_document` command to spawn Pandoc from the
 * Rust backend. Content is passed via stdin; output goes to a file
 * derived from the current document path.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./tauri-fs";

/** Supported export formats. */
export type ExportFormat = "pdf" | "latex";

/** Check whether Pandoc is installed. Returns the version string on success. */
export async function checkPandoc(): Promise<string> {
  return invoke<string>("check_pandoc");
}

/**
 * Derive the output path from the source file path and desired format.
 *
 * Replaces the `.md` extension with `.pdf` or `.tex`.
 * If the path has no `.md` extension, appends the format extension.
 */
function deriveOutputPath(sourcePath: string, format: ExportFormat): string {
  const ext = format === "pdf" ? ".pdf" : ".tex";
  if (sourcePath.endsWith(".md")) {
    return sourcePath.slice(0, -3) + ext;
  }
  return sourcePath + ext;
}

/**
 * Export a document to PDF or LaTeX via the Tauri Pandoc backend.
 *
 * @param content - The full markdown content to export (with includes expanded).
 * @param format - Target format: "pdf" or "latex".
 * @param sourcePath - Path of the source .md file (used to derive output path).
 * @returns The output file path on success.
 * @throws If not running in Tauri, if Pandoc is not installed, or if export fails.
 */
export async function exportDocument(
  content: string,
  format: ExportFormat,
  sourcePath: string,
): Promise<string> {
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
