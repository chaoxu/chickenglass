import { indentUnit, LanguageDescription } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { treeView } from "@overleaf/codemirror-tree-view";
import { defaultPlugins } from "../plugins";
import { cm6RichRenderExtensions } from "../render/cm6-rich-render-extensions";
import { coreDocumentStateExtensions } from "../state/document-state-extensions";
import {
  createMarkdownLanguageExtensions,
  createProjectConfigExtensions,
} from "./base-editor-extensions";
import { blockTypePickerExtension } from "./block-type-picker";
import {
  syntaxHighlightCompartment,
  themeCompartment,
  treeViewCompartment,
} from "./compartments";
import { emitWindowDebugLaneStateChange } from "./debug-lane-state";
import { debugPanelExtension } from "./debug-panel";
import type { EditorPluginManager } from "./editor-plugin";
import {
  renderModeExtensions,
  userSettingsExtensions,
} from "./extension-builders";
import { headingFold } from "./heading-fold";
import { editorKeybindings } from "./keybindings";
import { listOutlinerExtension } from "./list-outliner";
import { editorModeField } from "./editor-mode-state";
import { type ProjectConfig } from "./project-config";
import { referenceAutocompleteExtension } from "./reference-autocomplete";
import { richMouseSelectionStyle } from "./rich-mouse-selection";
import { shellSurfaceOverlayExtension } from "./shell-surface-overlay";
import { coflatDarkTheme, coflatTheme } from "./theme";
import { widgetStopIndexCleanupExtension } from "./widget-stop-index";

export {
  editorModeField,
  markdownEditorModes,
  setEditorMode,
  type EditorMode,
} from "./editor-mode-state";

const fallbackDocument = "# Untitled\n";
const debugLaneCompartment = new Compartment();
const defaultDebugLaneExtensions: Extension[] = [];

export {
  lineNumbersCompartment,
  tabSizeCompartment,
  themeCompartment,
  wordWrapCompartment,
} from "./compartments";

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

/** Editor chrome: folding, outliner, keybindings, picker, theme, debug panel. */
function editorChromeExtensions(isDark: boolean): Extension[] {
  return [
    headingFold,
    listOutlinerExtension,
    editorKeybindings,
    widgetStopIndexCleanupExtension,
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
        syntaxHighlighting: false,
      }),
      syntaxHighlightCompartment.of([]),

      // Core document state (frontmatter, semantics, block plugins, caches)
      ...coreDocumentStateExtensions(defaultPlugins),

      // Reference/citation completion from semantic + bibliography state
      referenceAutocompleteExtension,

      // Mode switching (render/editable/modeClass compartments)
      ...renderModeExtensions({
        editorModeField,
        renderingExtensions: cm6RichRenderExtensions,
      }),

      // Toggleable editor plugins (managed by EditorPluginManager)
      ...(config.pluginManager?.initialExtensions() ?? []),

      // User-configurable settings (word wrap, line numbers, tab size)
      ...userSettingsExtensions(tabSizeExtension(2)),

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

/** Build a tab-size extension from a numeric size (used by compartment reconfiguration). */
export function tabSizeExtension(size: number): Extension {
  return [EditorState.tabSize.of(size), indentUnit.of(" ".repeat(size))];
}
