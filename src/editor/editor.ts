import { type Extension, Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { LanguageDescription, indentUnit } from "@codemirror/language";
import type { EditorPluginManager } from "./editor-plugin";

import { frontmatterDecoration } from "./frontmatter-state";
import {
  containerAttributesPlugin,
  imageRenderPlugin,
  codeBlockRenderPlugin,
  checkboxRenderPlugin,
  mathPreviewPlugin,
  sectionNumberPlugin,
  fenceGuidePlugin,
  includeLabelPlugin,
  sidenoteRenderPlugin,
} from "../render";
import { searchHighlightPlugin } from "../render/search-highlight";
import { referenceRenderPlugin } from "../render/reference-render";
import {
  createPluginRegistryField,
  blockCounterField,
  blockRenderPlugin,
  defaultPlugins,
} from "../plugins";
import { documentSemanticsField } from "../semantics/codemirror-source";
import { bibliographyPlugin, bibDataField } from "../citations";
import { pdfPreviewField } from "../render/pdf-preview-cache";
import { type ProjectConfig } from "./project-config";
import { tableGridExtension } from "../render/table-grid";
import { editorKeybindings } from "./keybindings";
import { coflatTheme, coflatDarkTheme } from "./theme";
import { blockTypePickerExtension } from "./block-type-picker";
import { headingFold } from "./heading-fold";
import { listOutlinerExtension } from "./list-outliner";
import { treeView } from "@overleaf/codemirror-tree-view";
import {
  createMarkdownLanguageExtensions,
  createProjectConfigExtensions,
  sharedDocumentStateExtensions,
  sharedInlineRenderExtensions,
} from "./base-editor-extensions";

const fallbackDocument = "# Untitled\n";

/** Compartment for the debug tree-view panel — toggled via window.__cmTreeView(). */
const treeViewCompartment = new Compartment();

/** Editor display modes. */
export type EditorMode = "rich" | "source" | "read";

/** Markdown editor modes currently exposed in the UI. */
export const markdownEditorModes: readonly EditorMode[] = ["rich", "source"];

/**
 * Clamp a requested mode to one currently supported by the app shell.
 *
 * Read mode is intentionally disabled for now, so markdown files fall back to
 * rich mode when a caller requests `"read"`.
 */
export function normalizeEditorMode(mode: EditorMode, isMarkdown: boolean): EditorMode {
  if (!isMarkdown) return "source";
  return mode === "read" ? "rich" : mode;
}

/** StateEffect used to update the tracked editor mode. */
export const setEditorModeEffect = StateEffect.define<EditorMode>();

/**
 * CM6 StateField that tracks the current editor mode.
 *
 * Updated by `setEditorMode()` via `setEditorModeEffect`. Allows any
 * code with access to the EditorView (e.g. keybindings) to read the
 * current mode without relying on module-level mutable state.
 */
export const editorModeField = StateField.define<EditorMode>({
  create() {
    return "rich";
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setEditorModeEffect)) return effect.value;
    }
    return value;
  },
});

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
  ...sharedInlineRenderExtensions,
  imageRenderPlugin,
  blockRenderPlugin,
  referenceRenderPlugin,
  codeBlockRenderPlugin,
  bibliographyPlugin,
  containerAttributesPlugin,
  ...tableGridExtension, // decoration-based CSS grid tables (#407)
  checkboxRenderPlugin,
  mathPreviewPlugin,
  sectionNumberPlugin,
  fenceGuidePlugin,
  includeLabelPlugin,
  sidenoteRenderPlugin,
  searchHighlightPlugin,
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
      ...createProjectConfigExtensions(config.projectConfig),

      // Parser: markdown with custom extensions + code block language support
      ...createMarkdownLanguageExtensions({
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
        syntaxHighlighting: true,
      }),

      // Frontmatter state (always needed — other extensions read it)
      ...sharedDocumentStateExtensions,

      // Shared document semantics (headings, fenced divs, footnotes)
      documentSemanticsField,

      // Block plugin system
      createPluginRegistryField(defaultPlugins),
      blockCounterField,

      // Bibliography state (must come before citation plugins)
      bibDataField,

      // PDF preview cache (must come before image render plugin reads it)
      pdfPreviewField,

      // Rendering plugins (wrapped in compartment for mode switching)
      renderCompartment.of(renderingExtensions),

      // Editor mode state (queryable by keybindings and other consumers)
      editorModeField,

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
      blockTypePickerExtension,
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

  // Always record the new mode in the StateField so cycleEditorMode can read it.
  effects.push(setEditorModeEffect.of(mode));

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
