import { indentUnit, LanguageDescription } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { historyField } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { treeView } from "@overleaf/codemirror-tree-view";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../document-surface-classes";
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
import { type ProjectConfig, type ProjectConfigStatus } from "../project-config";
import { referenceAutocompleteExtension } from "./reference-autocomplete";
import { richMouseSelectionStyle } from "./rich-mouse-selection";
import { scrollStabilityExtension } from "./scroll-stability";
import { shellSurfaceOverlayExtension } from "./shell-surface-overlay";
import { stableHeightOracleExtension } from "./stable-height-oracle";
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
const cm6DocumentSurfaceExtensions: Extension[] = [
  EditorView.editorAttributes.of({
    class: documentSurfaceClassNames(DOCUMENT_SURFACE_CLASS.surface),
  }),
  EditorView.contentAttributes.of({
    class: documentSurfaceClassNames(DOCUMENT_SURFACE_CLASS.flow),
  }),
];

export {
  lineNumbersCompartment,
  tabSizeCompartment,
  themeCompartment,
  wordWrapCompartment,
} from "./compartments";

/** Standard code-language descriptions for fenced code blocks. */
const codeLanguageDescriptions: LanguageDescription[] = [
  LanguageDescription.of({ name: "javascript", alias: ["js", "jsx"], load: async () => javascript({ jsx: true }) }),
  LanguageDescription.of({ name: "typescript", alias: ["ts", "tsx"], load: async () => javascript({ jsx: true, typescript: true }) }),
  LanguageDescription.of({ name: "python", alias: ["py"], load: async () => python() }),
  LanguageDescription.of({ name: "html", alias: ["htm"], load: async () => html() }),
  LanguageDescription.of({ name: "css", alias: ["scss", "less"], load: async () => css() }),
  LanguageDescription.of({ name: "json", load: async () => json() }),
  LanguageDescription.of({ name: "java", load: async () => java() }),
  LanguageDescription.of({ name: "cpp", alias: ["c", "c++", "cc", "cxx", "h"], load: async () => cpp() }),
  LanguageDescription.of({ name: "rust", alias: ["rs"], load: async () => rust() }),
];

/** Editor chrome: folding, outliner, keybindings, picker, theme, debug panel. */
function editorChromeExtensions(isDark: boolean): Extension[] {
  return [
    headingFold,
    listOutlinerExtension,
    editorKeybindings,
    widgetStopIndexCleanupExtension,
    scrollStabilityExtension,
    stableHeightOracleExtension,
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
  /** Structured status for the project configuration source. */
  projectConfigStatus?: ProjectConfigStatus;
  /** Plugin manager for toggleable editor features. */
  pluginManager?: EditorPluginManager;
  /** Additional CM6 extensions to include. */
  extensions?: Extension[];
  /** Optional restored CodeMirror history state for remounting the same document. */
  initialHistoryState?: Cm6HistoryState | null;
}

export type Cm6HistoryState = unknown;

export function captureEditorHistoryState(state: EditorState): Cm6HistoryState | undefined {
  return state.field(historyField, false);
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
      ...createProjectConfigExtensions(config.projectConfig, config.projectConfigStatus),

      // Parser: markdown with custom extensions + code block language support
      ...createMarkdownLanguageExtensions({
        codeLanguages: codeLanguageDescriptions,
        syntaxHighlighting: false,
      }),
      syntaxHighlightCompartment.of([]),

      // Core document state (frontmatter, semantics, block plugins, caches)
      ...coreDocumentStateExtensions(defaultPlugins),

      // Shared cross-editor document surface contract.
      ...cm6DocumentSurfaceExtensions,

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

      ...(config.initialHistoryState
        ? [historyField.init(() => config.initialHistoryState)]
        : []),

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
