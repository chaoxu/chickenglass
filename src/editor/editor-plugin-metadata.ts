export interface EditorPluginMetadata {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly defaultEnabled: boolean;
}

export const focusModePluginMetadata: EditorPluginMetadata = {
  id: "focus-mode",
  name: "Focus Mode",
  description: "Dim content outside current paragraph",
  defaultEnabled: false,
};

export const debugInspectorPluginMetadata: EditorPluginMetadata = {
  id: "debug-inspector",
  name: "Debug Inspector",
  description: "Color-coded syntax node overlays",
  defaultEnabled: false,
};

export const hoverPreviewPluginMetadata: EditorPluginMetadata = {
  id: "hover-preview",
  name: "Hover Preview",
  description: "Tooltip previews for cross-references",
  defaultEnabled: true,
};

export const spellcheckPluginMetadata: EditorPluginMetadata = {
  id: "spellcheck",
  name: "Spell Check",
  description: "Browser-native spellcheck",
  defaultEnabled: false,
};

export const findReplacePluginMetadata: EditorPluginMetadata = {
  id: "find-replace",
  name: "Find & Replace",
  description: "Search panel (Cmd+F)",
  defaultEnabled: true,
};

export const defaultEditorPluginMetadata: EditorPluginMetadata[] = [
  focusModePluginMetadata,
  debugInspectorPluginMetadata,
  hoverPreviewPluginMetadata,
  spellcheckPluginMetadata,
  findReplacePluginMetadata,
];
