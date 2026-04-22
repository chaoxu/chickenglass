import type { ExportFormat } from "../lib/types";
import { tauriArgs, tauriCommand } from "./make-command";

/** Check whether Pandoc is installed. Returns the version string on success. */
export const checkPandocCommand = tauriCommand<string>("check_pandoc");

/** Export a document through the Rust/Pandoc backend. */
export const exportDocumentCommand = tauriArgs<string>("export_document")(
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
