import type { EditorPlugin } from "./editor-plugin";
import { focusModeExtension } from "../render/focus-mode";
import { debugInspectorPlugin } from "../render/debug-inspector";
import { hoverPreviewExtension } from "../render/hover-preview";
import { spellcheckExtension } from "./spellcheck";
import { findReplaceExtension } from "./find-replace";
import {
  debugInspectorPluginMetadata,
  findReplacePluginMetadata,
  focusModePluginMetadata,
  hoverPreviewPluginMetadata,
  spellcheckPluginMetadata,
} from "./editor-plugin-metadata";

export const focusModePlugin: EditorPlugin = {
  ...focusModePluginMetadata,
  extensions: () => focusModeExtension,
};

export const debugInspectorEditorPlugin: EditorPlugin = {
  ...debugInspectorPluginMetadata,
  extensions: () => debugInspectorPlugin,
};

export const hoverPreviewPlugin: EditorPlugin = {
  ...hoverPreviewPluginMetadata,
  extensions: () => hoverPreviewExtension,
};

export const spellcheckPlugin: EditorPlugin = {
  ...spellcheckPluginMetadata,
  extensions: () => spellcheckExtension,
};

export const findReplacePlugin: EditorPlugin = {
  ...findReplacePluginMetadata,
  extensions: () => findReplaceExtension,
};

export const defaultEditorPlugins: EditorPlugin[] = [
  focusModePlugin,
  debugInspectorEditorPlugin,
  hoverPreviewPlugin,
  spellcheckPlugin,
  findReplacePlugin,
];
