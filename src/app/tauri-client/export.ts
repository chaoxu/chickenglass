import type { ExportFormat } from "../lib/types";
import { TAURI_COMMANDS } from "./bridge-metadata";
import { tauriCommand, tauriArgs } from "./make-command";

/** Check whether Pandoc is installed. Returns the version string on success. */
export const checkPandocCommand = tauriCommand<string>(TAURI_COMMANDS.checkPandoc);

/** Export a document to PDF or LaTeX via the Rust/Pandoc backend. */
export const exportDocumentCommand = tauriArgs<string>(TAURI_COMMANDS.exportDocument)(
  (content: string, format: ExportFormat, outputPath: string, sourcePath: string) => ({
    content,
    format,
    outputPath,
    sourcePath,
  }),
);
