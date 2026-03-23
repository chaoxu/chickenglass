import type { ExportFormat } from "../lib/types";
import { invokeWithPerf } from "../perf";

/** Check whether Pandoc is installed. Returns the version string on success. */
export function checkPandocCommand(): Promise<string> {
  return invokeWithPerf<string>("check_pandoc");
}

/** Export a document to PDF or LaTeX via the Rust/Pandoc backend. */
export function exportDocumentCommand(
  content: string,
  format: ExportFormat,
  outputPath: string,
): Promise<string> {
  return invokeWithPerf<string>("export_document", {
    content,
    format,
    outputPath,
  });
}
