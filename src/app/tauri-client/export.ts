import type { ExportFormat } from "../lib/types";
import { TAURI_COMMAND_CONTRACT } from "./command-contract";
import { tauriArgs } from "./make-command";

const exportCommands = TAURI_COMMAND_CONTRACT.export;

/** Check whether export dependencies for a target format are installed. */
export const checkPandocCommand = tauriArgs(exportCommands.checkPandoc)(
  (format: ExportFormat): { format: ExportFormat } => ({ format }),
);

/** Export a document through the Rust/Pandoc backend. */
export const exportDocumentCommand = tauriArgs(exportCommands.exportDocument)(
  (
    content: string,
    format: ExportFormat,
    outputPath: string,
    sourcePath: string,
    options: { bibliography?: string; template?: string } = {},
  ) => ({
    bibliography: options.bibliography,
    content,
    format,
    outputPath,
    sourcePath,
    template: options.template,
  }),
);
