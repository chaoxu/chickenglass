import { markdown } from "@codemirror/lang-markdown";
import { type Extension, Compartment, EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { Table, TaskList } from "@lezer/markdown";
import {
  removeIndentedCode,
  mathExtension,
  fencedDiv,
  equationLabelExtension,
  strikethroughExtension,
  highlightExtension,
  footnoteExtension,
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
  includeLabelPlugin,
  focusModeExtension,
  sidenoteRenderPlugin,
  hoverPreviewExtension,
} from "../render";
import {
  createPluginRegistryField,
  blockCounterField,
  blockRenderPlugin,
  defaultPlugins,
} from "../plugins";
import { citationRenderPlugin, bibliographyPlugin, bibDataField } from "../citations";
import { projectConfigFacet, type ProjectConfig } from "../app/project-config";
import { editorKeybindings } from "./keybindings";
import { chickenglassTheme } from "./theme";
import { headingFold } from "./heading-fold";
import { listOutlinerExtension } from "./list-outliner";
import { breadcrumbExtension } from "../app/breadcrumbs";

const fallbackDocument = "# Untitled\n";

/** Editor display modes. */
export type EditorMode = "rendered" | "source" | "preview";

/** Compartment for rendering extensions — reconfigured on mode switch. */
const renderCompartment = new Compartment();

/** Compartment for editability — reconfigured for preview mode. */
const editableCompartment = new Compartment();

/** All rendering extensions that get toggled by mode. */
const renderingExtensions: Extension[] = [
  frontmatterDecoration,
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
  includeLabelPlugin,
  focusModeExtension,
  sidenoteRenderPlugin,
  hoverPreviewExtension,
];

export interface EditorConfig {
  /** The DOM element to mount the editor into. */
  parent: HTMLElement;
  /** Initial document content. */
  doc?: string;
  /** Project-level configuration to merge with per-file frontmatter. */
  projectConfig?: ProjectConfig;
  /** Additional CM6 extensions to include. */
  extensions?: Extension[];
}

/** Create and mount a CodeMirror 6 markdown editor. */
export function createEditor(config: EditorConfig): EditorView {
  const state = EditorState.create({
    doc: config.doc ?? fallbackDocument,
    extensions: [
      // Project config (must come before frontmatterField so the facet is available)
      ...(config.projectConfig ? [projectConfigFacet.of(config.projectConfig)] : []),

      // Parser: markdown with custom extensions
      markdown({
        extensions: [
          removeIndentedCode,
          mathExtension,
          fencedDiv,
          equationLabelExtension,
          strikethroughExtension,
          highlightExtension,
          footnoteExtension,
          Table,
          TaskList,
        ],
      }),

      // Frontmatter state (always needed — other extensions read it)
      frontmatterField,

      // Block plugin system
      createPluginRegistryField(defaultPlugins),
      blockCounterField,

      // Bibliography state (must come before citation plugins)
      bibDataField,

      // Rendering plugins (wrapped in compartment for mode switching)
      renderCompartment.of(renderingExtensions),

      // Editability (wrapped in compartment for preview mode)
      editableCompartment.of([]),

      // Editor chrome
      EditorView.lineWrapping,
      headingFold,
      listOutlinerExtension,
      breadcrumbExtension,
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

/**
 * Switch the editor between rendered, source, and preview modes.
 *
 * - **rendered**: Typora-style — decorations active, editable (default)
 * - **source**: plain markdown — no decorations, editable
 * - **preview**: rendered — decorations active, read-only
 */
export function setEditorMode(view: EditorView, mode: EditorMode): void {
  const effects: StateEffect<unknown>[] = [];

  switch (mode) {
    case "rendered":
      effects.push(renderCompartment.reconfigure(renderingExtensions));
      effects.push(editableCompartment.reconfigure([]));
      break;
    case "source":
      effects.push(renderCompartment.reconfigure([]));
      effects.push(editableCompartment.reconfigure([]));
      break;
    case "preview":
      effects.push(renderCompartment.reconfigure(renderingExtensions));
      effects.push(editableCompartment.reconfigure(EditorView.editable.of(false)));
      break;
  }

  view.dispatch({ effects });
}
