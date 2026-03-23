// Re-export canonical types from their source modules.
export type { Tab } from "../tab-bar";
export type { EditorMode } from "../../editor";
export type { Theme } from "../theme-manager";

import type { EditorMode } from "../../editor";
import type { Theme } from "../theme-manager";

export type ExportFormat = "pdf" | "latex" | "html";

/** UI-layer settings shape for the React shell. */
export interface Settings {
  autoSaveInterval: number;
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  showLineNumbers: boolean;
  wordWrap: boolean;
  /** @deprecated Use `enabledPlugins["spellcheck"]` instead. Kept for migration. */
  spellCheck: boolean;
  editorMode: EditorMode;
  theme: Theme;
  defaultExportFormat: ExportFormat;
  /** Per-plugin enabled/disabled overrides. Keys are plugin IDs, values are booleans. */
  enabledPlugins: Record<string, boolean>;
  /** Selected writing theme id (e.g., "default", "sepia", "nord", "dracula"). */
  themeName: string;
  /** Selected writing preset id (e.g., "academic", "monospace", "modern"). */
  writingTheme: string;
  /** User-provided custom CSS injected via a <style> tag. */
  customCss: string;
}
