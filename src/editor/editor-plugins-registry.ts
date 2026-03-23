import type { EditorPlugin } from "./editor-plugin";
// Direct imports: barrel would create circular dependency (editor/index → editor-plugins-registry → render/index → search-highlight → editor/index)
import { focusModeExtension } from "../render/focus-mode";
import { debugInspectorPlugin } from "../render/debug-inspector";
import { hoverPreviewExtension } from "../render/hover-preview";
import { spellcheckExtension } from "./spellcheck";
import { findReplaceExtension } from "./find-replace";

export const focusModePlugin: EditorPlugin = {
  id: "focus-mode",
  name: "Focus Mode",
  description: "Dim content outside current paragraph",
  defaultEnabled: false,
  extensions: () => focusModeExtension,
};

export const debugInspectorEditorPlugin: EditorPlugin = {
  id: "debug-inspector",
  name: "Debug Inspector",
  description: "Color-coded syntax node overlays",
  defaultEnabled: false,
  extensions: () => debugInspectorPlugin,
};

export const hoverPreviewPlugin: EditorPlugin = {
  id: "hover-preview",
  name: "Hover Preview",
  description: "Tooltip previews for cross-references",
  defaultEnabled: true,
  extensions: () => hoverPreviewExtension,
};

export const spellcheckPlugin: EditorPlugin = {
  id: "spellcheck",
  name: "Spell Check",
  description: "Browser-native spellcheck",
  defaultEnabled: false,
  extensions: () => spellcheckExtension,
};

export const findReplacePlugin: EditorPlugin = {
  id: "find-replace",
  name: "Find & Replace",
  description: "Search panel (Cmd+F)",
  defaultEnabled: true,
  extensions: () => findReplaceExtension,
};

export const defaultEditorPlugins: EditorPlugin[] = [
  focusModePlugin,
  debugInspectorEditorPlugin,
  hoverPreviewPlugin,
  spellcheckPlugin,
  findReplacePlugin,
];
