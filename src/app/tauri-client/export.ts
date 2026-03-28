import type { ExportFormat } from "../lib/types";
import { tauriCommand, tauriArgs } from "./make-command";

/** Check whether Pandoc is installed. Returns the version string on success. */
export const checkPandocCommand = tauriCommand<string>("check_pandoc");

/** Export a document to PDF or LaTeX via the Rust/Pandoc backend. */
export const exportDocumentCommand = tauriArgs<string>("export_document")(
  (content: string, format: ExportFormat, outputPath: string) => ({ content, format, outputPath }),
);
