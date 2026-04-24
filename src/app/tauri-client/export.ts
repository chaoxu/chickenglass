import type { ExportFormat } from "../lib/types";
import { TAURI_COMMAND_CONTRACT } from "./command-contract";
import { tauriArgs, tauriCommand } from "./make-command";

const exportCommands = TAURI_COMMAND_CONTRACT.export;

/** Check whether Pandoc is installed. Returns the version string on success. */
export const checkPandocCommand = tauriCommand(exportCommands.checkPandoc);

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
