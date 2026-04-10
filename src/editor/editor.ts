import { type Extension, Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { LanguageDescription, indentUnit } from "@codemirror/language";
import type { EditorPluginManager } from "./editor-plugin";

import { frontmatterDecoration } from "./frontmatter-render";
import {
  containerAttributesPlugin,
  imageRenderPlugin,
  codeBlockRenderPlugin,
  codeBlockStructureField,
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
  blockRenderPlugin,
  defaultPlugins,
} from "../plugins";
import { blockCounterField } from "../state/block-counter";
import { createPluginRegistryField } from "../state/plugin-registry";
import { documentSemanticsField } from "../state/document-analysis";
import { bibliographyPlugin, bibDataField } from "../citations";
import { pdfPreviewField } from "../render/pdf-preview-cache";
import { imageUrlField } from "../render/image-url-cache";
import { type ProjectConfig } from "./project-config";
import { tableRenderPlugin } from "../render/table-render";
import { editorKeybindings } from "./keybindings";
import { coflatTheme, coflatDarkTheme } from "./theme";
import { blockTypePickerExtension } from "./block-type-picker";
import { headingFold } from "./heading-fold";
import { listOutlinerExtension } from "./list-outliner";
import { richMouseSelectionStyle } from "./rich-mouse-selection";
import { treeView } from "@overleaf/codemirror-tree-view";
import { includeRegionsField } from "../lib/include-regions";
import { referenceAutocompleteExtension } from "./reference-autocomplete";
import { richClipboardOutputFilter } from "./rich-clipboard";
import { debugPanelExtension } from "./debug-panel";
import { shellSurfaceOverlayExtension } from "./shell-surface-overlay";
import { emitWindowDebugLaneStateChange } from "./debug-lane-state";
import {
  createMarkdownLanguageExtensions,
  createProjectConfigExtensions,
  sharedInlineRenderExtensions,
} from "./base-editor-extensions";
import { documentLabelGraphField } from "../semantics/document-label-graph";
import { documentReferenceCatalogField } from "../semantics/editor-reference-catalog";
import { frontmatterField } from "./frontmatter-state";
import { activeStructureEditField } from "./structure-edit-state";

const fallbackDocument = "# Untitled\n";

/** Compartment for the debug tree-view panel — toggled via window.__cmTreeView(). */
const treeViewCompartment = new Compartment();
const debugLaneCompartment = new Compartment();
const defaultDebugLaneExtensions: Extension[] = [];

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
  codeBlockStructureField,
  blockRenderPlugin,
  referenceRenderPlugin,
  codeBlockRenderPlugin,
  bibliographyPlugin,
  containerAttributesPlugin,
  richClipboardOutputFilter,
  tableRenderPlugin,
  checkboxRenderPlugin,
  mathPreviewPlugin,
  sectionNumberPlugin,
  fenceGuidePlugin,
  includeLabelPlugin,
  sidenoteRenderPlugin,
  searchHighlightPlugin,
];

/** Standard code-language descriptions for fenced code blocks. */
const codeLanguageDescriptions: LanguageDescription[] = [
  LanguageDescription.of({ name: "javascript", alias: ["js", "jsx"], load: () => import("@codemirror/lang-javascript").then(m => m.javascript({ jsx: true })) }),
  LanguageDescription.of({ name: "typescript", alias: ["ts", "tsx"], load: () => import("@codemirror/lang-javascript").then(m => m.javascript({ jsx: true, typescript: true })) }),
  LanguageDescription.of({ name: "python", alias: ["py"], load: () => import("@codemirror/lang-python").then(m => m.python()) }),
  LanguageDescription.of({ name: "html", alias: ["htm"], load: () => import("@codemirror/lang-html").then(m => m.html()) }),
  LanguageDescription.of({ name: "css", alias: ["scss", "less"], load: () => import("@codemirror/lang-css").then(m => m.css()) }),
  LanguageDescription.of({ name: "json", load: () => import("@codemirror/lang-json").then(m => m.json()) }),
  LanguageDescription.of({ name: "java", load: () => import("@codemirror/lang-java").then(m => m.java()) }),
  LanguageDescription.of({ name: "cpp", alias: ["c", "c++", "cc", "cxx", "h"], load: () => import("@codemirror/lang-cpp").then(m => m.cpp()) }),
  LanguageDescription.of({ name: "rust", alias: ["rs"], load: () => import("@codemirror/lang-rust").then(m => m.rust()) }),
];

/** Document-level state fields that must survive mode switches. */
function coreDocumentStateExtensions(): Extension[] {
  return [
    // Frontmatter state (always needed — other extensions read it)
    frontmatterField,

    // Explicit rich-mode structure editing state (stable-shell experiment)
    activeStructureEditField,

    // Include expansion metadata must survive Rich/Source mode switches.
    includeRegionsField,

    // Shared document semantics (headings, fenced divs, footnotes)
    documentSemanticsField,

    // Block plugin system
    createPluginRegistryField(defaultPlugins),
    blockCounterField,
    documentReferenceCatalogField,
    documentLabelGraphField,

    // Bibliography state (must come before citation plugins)
    bibDataField,

    // PDF preview cache (must come before image render plugin reads it)
    pdfPreviewField,
    imageUrlField,
  ];
}

/** Compartment-wrapped extensions for rich/source/read mode switching. */
function renderModeExtensions(): Extension[] {
  return [
    // Rendering plugins (wrapped in compartment for mode switching)
    renderCompartment.of(renderingExtensions),

    // Editor mode state (queryable by keybindings and other consumers)
    editorModeField,

    // Editability (wrapped in compartment for preview mode)
    editableCompartment.of([]),

    // Mode-specific CSS classes (source mode, read mode)
    modeClassCompartment.of([]),
  ];
}

/** User-configurable settings wrapped in live-reconfigurable compartments. */
function userSettingsExtensions(): Extension[] {
  return [
    wordWrapCompartment.of(EditorView.lineWrapping),
    lineNumbersCompartment.of([]),
    tabSizeCompartment.of(tabSizeExtension(2)),
  ];
}

/** Editor chrome: folding, outliner, keybindings, picker, theme, debug panel. */
function editorChromeExtensions(isDark: boolean): Extension[] {
  return [
    headingFold,
    listOutlinerExtension,
    editorKeybindings,
    richMouseSelectionStyle,
    blockTypePickerExtension,
    debugLaneCompartment.of(defaultDebugLaneExtensions),
    coflatTheme,

    // Dark/light base theme (wrapped in compartment for live switching)
    themeCompartment.of(isDark ? coflatDarkTheme : []),

    // Debug tree view (off by default, toggle via window.__cmTreeView())
    treeViewCompartment.of([]),
  ];
}

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

function hasCompartmentContent(extension: Extension | undefined): boolean {
  return extension !== undefined && (!Array.isArray(extension) || extension.length > 0);
}

/**
 * Toggle the Lezer tree-view debug panel.
 * Call from console: `__cmDebug.toggleTreeView()`.
 */
export function toggleTreeView(view: EditorView): boolean {
  const nextEnabled = !hasCompartmentContent(treeViewCompartment.get(view.state));
  view.dispatch({
    effects: treeViewCompartment.reconfigure(nextEnabled ? treeView : []),
  });
  return nextEnabled;
}

export function isDebugLaneEnabled(view: EditorView): boolean {
  return hasCompartmentContent(debugLaneCompartment.get(view.state));
}

export function setDebugLaneEnabled(view: EditorView, enabled: boolean): boolean {
  const nextExtensions = enabled
    ? [shellSurfaceOverlayExtension, debugPanelExtension]
    : [];
  view.dispatch({
    effects: debugLaneCompartment.reconfigure(nextExtensions),
  });
  emitWindowDebugLaneStateChange();
  return enabled;
}

export function toggleDebugLane(view: EditorView): boolean {
  const nextEnabled = !isDebugLaneEnabled(view);
  setDebugLaneEnabled(view, nextEnabled);
  return nextEnabled;
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
        codeLanguages: codeLanguageDescriptions,
        syntaxHighlighting: true,
      }),

      // Core document state (frontmatter, semantics, block plugins, caches)
      ...coreDocumentStateExtensions(),

      // Reference/citation completion from semantic + bibliography state
      referenceAutocompleteExtension,

      // Mode switching (render/editable/modeClass compartments)
      ...renderModeExtensions(),

      // Toggleable editor plugins (managed by EditorPluginManager)
      ...(config.pluginManager?.initialExtensions() ?? []),

      // User-configurable settings (word wrap, line numbers, tab size)
      ...userSettingsExtensions(),

      // Editor chrome (folding, outliner, keybindings, picker, theme)
      ...editorChromeExtensions(isDark),

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
