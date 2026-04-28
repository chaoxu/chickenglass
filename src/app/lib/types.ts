// Re-export canonical types from their source modules.

export type { EditorMode } from "../../editor-display-mode";
export type { Tab } from "../tab-bar";
export type { Theme } from "../theme-manager";

import type { EditorMode } from "../../editor-display-mode";
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
  /** Skip "unsaved changes" confirmation when switching files. Useful during dev/testing. */
  skipDirtyConfirm: boolean;
}
