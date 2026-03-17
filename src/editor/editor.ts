import { markdown } from "@codemirror/lang-markdown";
import { type Extension, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { Table, TaskList } from "@lezer/markdown";
import {
  removeIndentedCode,
  mathExtension,
  fencedDiv,
  equationLabelExtension,
  strikethroughExtension,
  highlightExtension,
} from "../parser";
import { frontmatterField, frontmatterDecoration } from "./frontmatter-state";
import {
  markdownRenderPlugin,
  mathRenderPlugin,
  crossrefRenderPlugin,
  containerAttributesPlugin,
  imageRenderPlugin,
  codeBlockRenderPlugin,
  tableRenderPlugin,
  debugInspectorPlugin,
  checkboxRenderPlugin,
  mathPreviewPlugin,
  sectionNumberPlugin,
  fenceGuidePlugin,
} from "../render";
import {
  createPluginRegistryField,
  blockCounterField,
  blockRenderPlugin,
  defaultPlugins,
} from "../plugins";
import { bibDataField, citationRenderPlugin, bibliographyPlugin } from "../citations";
import { editorKeybindings } from "./keybindings";
import { chickenglassTheme } from "./theme";
import { headingFold } from "./heading-fold";

/** Minimal fallback document when no content is provided. */
const fallbackDocument = "# Untitled\n";

export interface EditorConfig {
  /** The DOM element to mount the editor into. */
  parent: HTMLElement;
  /** Initial document content. */
  doc?: string;
  /** Additional CM6 extensions to include. */
  extensions?: Extension[];
}

/** Create and mount a CodeMirror 6 markdown editor. */
export function createEditor(config: EditorConfig): EditorView {
  const state = EditorState.create({
    doc: config.doc ?? fallbackDocument,
    extensions: [
      // Parser: markdown with custom extensions
      markdown({
        extensions: [
          removeIndentedCode,
          mathExtension,
          fencedDiv,
          equationLabelExtension,
          strikethroughExtension,
          highlightExtension,
          Table,
          TaskList,
        ],
      }),

      // Frontmatter state (must come before plugins that depend on it)
      frontmatterField,
      frontmatterDecoration,

      // Block plugin system
      createPluginRegistryField(defaultPlugins),
      blockCounterField,

      // Bibliography state (must come before citation plugins)
      bibDataField,

      // Rendering plugins
      markdownRenderPlugin,
      mathRenderPlugin,
      imageRenderPlugin,
      blockRenderPlugin,
      crossrefRenderPlugin,
      codeBlockRenderPlugin,
      citationRenderPlugin,
      bibliographyPlugin,
      containerAttributesPlugin,
      tableRenderPlugin,
      debugInspectorPlugin,
      checkboxRenderPlugin,
      mathPreviewPlugin,
      sectionNumberPlugin,
      fenceGuidePlugin,

      // Editor chrome
      EditorView.lineWrapping,
      headingFold,
      editorKeybindings,
      chickenglassTheme,

      // User-provided extensions last
      ...(config.extensions ?? []),
    ],
  });

  return new EditorView({
    state,
    parent: config.parent,
  });
}
