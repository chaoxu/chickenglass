// Re-export canonical types from their source modules.
export type { Tab } from "../tab-bar";
export type { EditorMode } from "../../editor/editor";

import type { EditorMode } from "../../editor/editor";

/** UI-layer settings shape for the React shell. */
export interface Settings {
  autoSaveInterval: number;
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  showLineNumbers: boolean;
  wordWrap: boolean;
  spellCheck: boolean;
  editorMode: EditorMode;
  theme: string;
}
