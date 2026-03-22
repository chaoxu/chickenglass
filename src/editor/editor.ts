import { markdown } from "@codemirror/lang-markdown";
import { type Extension, Compartment, EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { LanguageDescription, syntaxHighlighting, indentUnit } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import type { EditorPluginManager } from "./editor-plugin";

import { markdownExtensions } from "../parser";
import { frontmatterField, frontmatterDecoration } from "./frontmatter-state";
import {
  markdownRenderPlugin,
  mathRenderPlugin,
  crossrefRenderPlugin,
  containerAttributesPlugin,
  imageRenderPlugin,
  codeBlockRenderPlugin,
  tableRenderPlugin,
  checkboxRenderPlugin,
  mathPreviewPlugin,
  sectionNumberPlugin,
  fenceGuidePlugin,
  includeLabelPlugin,
  sidenoteRenderPlugin,
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
import { coflatTheme, coflatDarkTheme } from "./theme";
import { headingFold } from "./heading-fold";
import { listOutlinerExtension } from "./list-outliner";
import { treeView } from "@overleaf/codemirror-tree-view";

const fallbackDocument = "# Untitled\n";

/** Compartment for the debug tree-view panel — toggled via window.__cmTreeView(). */
const treeViewCompartment = new Compartment();

/** Editor display modes. */
export type EditorMode = "rich" | "source" | "read";

/** Compartment for rendering extensions — reconfigured on mode switch. */
const renderCompartment = new Compartment();

/** Compartment for editability — reconfigured for read mode. */
const editableCompartment = new Compartment();

/** Compartment for mode-specific CSS classes on .cm-editor. */
const modeClassCompartment = new Compartment();

/** Compartment for the CM6 dark/light base theme — reconfigured on theme switch. */
export const themeCompartment = new Compartment();

/** Compartment for word wrap (EditorView.lineWrapping). */
export const wordWrapCompartment = new Compartment();

/** Compartment for line numbers gutter. */
export const lineNumbersCompartment = new Compartment();

/** Compartment for tab size (EditorState.tabSize + indentUnit). */
export const tabSizeCompartment = new Compartment();

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
  checkboxRenderPlugin,
  mathPreviewPlugin,
  sectionNumberPlugin,
  fenceGuidePlugin,
  includeLabelPlugin,
  sidenoteRenderPlugin,
];

export interface EditorConfig {
  /** The DOM element to mount the editor into. */
  parent: HTMLElement;
  /** Initial document content. */
  doc?: string;
  /** Project-level configuration to merge with per-file frontmatter. */
  projectConfig?: ProjectConfig;
  /** Plugin manager for toggleable editor features. */
  pluginManager?: EditorPluginManager;
  /** Additional CM6 extensions to include. */
  extensions?: Extension[];
}

let treeViewEnabled = false;

/**
 * Toggle the Lezer tree-view debug panel.
 * Call from console: `__cmDebug.toggleTreeView()`.
 */
export function toggleTreeView(view: EditorView): boolean {
  treeViewEnabled = !treeViewEnabled;
  view.dispatch({
    effects: treeViewCompartment.reconfigure(treeViewEnabled ? treeView : []),
  });
  return treeViewEnabled;
}

/** Create and mount a CodeMirror 6 markdown editor. */
export function createEditor(config: EditorConfig): EditorView {
  const isDark = document.documentElement.dataset.theme === "dark";

  const state = EditorState.create({
    doc: config.doc ?? fallbackDocument,
    extensions: [
      // Project config (must come before frontmatterField so the facet is available)
      ...(config.projectConfig ? [projectConfigFacet.of(config.projectConfig)] : []),

      // Parser: markdown with custom extensions + code block language support
      markdown({
        extensions: markdownExtensions,
        codeLanguages: [
          LanguageDescription.of({ name: "javascript", alias: ["js", "jsx"], load: () => import("@codemirror/lang-javascript").then(m => m.javascript({ jsx: true })) }),
          LanguageDescription.of({ name: "typescript", alias: ["ts", "tsx"], load: () => import("@codemirror/lang-javascript").then(m => m.javascript({ jsx: true, typescript: true })) }),
          LanguageDescription.of({ name: "python", alias: ["py"], load: () => import("@codemirror/lang-python").then(m => m.python()) }),
          LanguageDescription.of({ name: "html", alias: ["htm"], load: () => import("@codemirror/lang-html").then(m => m.html()) }),
          LanguageDescription.of({ name: "css", alias: ["scss", "less"], load: () => import("@codemirror/lang-css").then(m => m.css()) }),
          LanguageDescription.of({ name: "json", load: () => import("@codemirror/lang-json").then(m => m.json()) }),
          LanguageDescription.of({ name: "java", load: () => import("@codemirror/lang-java").then(m => m.java()) }),
          LanguageDescription.of({ name: "cpp", alias: ["c", "c++", "cc", "cxx", "h"], load: () => import("@codemirror/lang-cpp").then(m => m.cpp()) }),
          LanguageDescription.of({ name: "rust", alias: ["rs"], load: () => import("@codemirror/lang-rust").then(m => m.rust()) }),
        ],
      }),

      // Syntax highlighting: apply tok-* CSS classes from parse tree tags
      syntaxHighlighting(classHighlighter),

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

      // Mode-specific CSS classes (source mode, read mode)
      modeClassCompartment.of([]),

      // Toggleable editor plugins (managed by EditorPluginManager)
      ...(config.pluginManager?.initialExtensions() ?? []),

      // User-configurable settings (wrapped in compartments for live reconfiguration)
      wordWrapCompartment.of(EditorView.lineWrapping),
      lineNumbersCompartment.of([]),
      tabSizeCompartment.of(tabSizeExtension(2)),

      // Editor chrome
      headingFold,
      listOutlinerExtension,
      editorKeybindings,
      coflatTheme,

      // Dark/light base theme (wrapped in compartment for live switching)
      themeCompartment.of(isDark ? coflatDarkTheme : []),

      // Debug tree view (off by default, toggle via window.__cmTreeView())
      treeViewCompartment.of([]),

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
 * Switch the editor between rich, source, and read modes.
 *
 * - **rich**: Typora-style — decorations active, editable (default)
 * - **source**: plain markdown — no decorations, editable
 * - **read**: decorations active, read-only
 */
export function setEditorMode(view: EditorView, mode: EditorMode): void {
  const effects: StateEffect<unknown>[] = [];

  switch (mode) {
    case "rich":
      effects.push(renderCompartment.reconfigure(renderingExtensions));
      effects.push(editableCompartment.reconfigure([]));
      effects.push(modeClassCompartment.reconfigure([]));
      break;
    case "source":
      effects.push(renderCompartment.reconfigure([]));
      effects.push(editableCompartment.reconfigure([]));
      effects.push(modeClassCompartment.reconfigure(
        EditorView.editorAttributes.of({ class: "cf-source-mode" }),
      ));
      break;
    case "read":
      effects.push(renderCompartment.reconfigure(renderingExtensions));
      effects.push(editableCompartment.reconfigure(EditorView.editable.of(false)));
      effects.push(modeClassCompartment.reconfigure(
        EditorView.editorAttributes.of({ class: "cf-read-mode" }),
      ));
      break;
  }

  view.dispatch({ effects });
}

/** Build a tab-size extension from a numeric size (used by compartment reconfiguration). */
export function tabSizeExtension(size: number): Extension {
  return [EditorState.tabSize.of(size), indentUnit.of(" ".repeat(size))];
}
