/**
 * Single owner for the `window.__*` debug bridge.
 *
 * Exposes a stable, eagerly-initialized surface for console and Playwright
 * consumers. `window.__app`, `window.__editor`, etc. are present immediately
 * at module load; their methods delegate through this module's state and
 * throw a clear `DebugBridgeError` if called before a provider has connected.
 *
 * Callers attach their implementations via `connect*Bridge(...)` and detach
 * via `disconnect*Bridge()`; internal consumers read the same state through
 * `getConnectedApp()`, `getConnectedEditor()`, etc. — no optional chaining
 * around `window.__app` is needed.
 */
import type { LexicalEditor } from "lexical";
import type { SourceMap } from "../app/source-map";
import type { EditorMode } from "../app/editor-mode";
import type {
  DebugDocumentState,
  DebugProjectFile,
} from "../app/hooks/use-app-debug-types";
import { getActiveEditor } from "../lexical/active-editor-tracker";
import { readLexicalTree } from "../lexical/tree-print";

export interface AppBridgeMethods {
  openFile: (path: string) => Promise<void>;
  hasFile: (path: string) => Promise<boolean>;
  openFileWithContent: (name: string, content: string) => Promise<void>;
  loadFixtureProject?: (
    files: readonly DebugProjectFile[],
    initialPath?: string,
  ) => Promise<void>;
  saveFile: () => Promise<void>;
  closeFile: (options?: { discard?: boolean }) => Promise<boolean>;
  setSearchOpen: (open: boolean) => void;
  setMode: (mode: EditorMode) => void;
  getMode: () => EditorMode;
  getProjectRoot: () => string | null;
  getCurrentDocument: () => DebugDocumentState | null;
  isDirty: () => boolean;
}

export interface EditorBridgeMethods {
  focus: () => void;
  getDoc: () => string;
  getSelection: () => {
    anchor: number;
    focus: number;
    from: number;
    to: number;
  };
  insertText: (text: string) => void;
  setDoc: (doc: string) => void;
  setSelection: (anchor: number, focus?: number) => void;
}

export interface TauriSmokeMethods {
  openProject: (path: string) => Promise<boolean>;
  openFile: (path: string) => Promise<void>;
  requestNativeClose: () => Promise<void>;
  listWindows: () => Promise<Array<{ label: string; focused: boolean }>>;
  getWindowState: () => Promise<TauriSmokeWindowState>;
  simulateExternalChange: (
    relativePath: string,
    treeChanged?: boolean,
  ) => Promise<void>;
}

export interface TauriSmokeWindowState {
  projectRoot: string | null;
  currentDocument: DebugDocumentState | null;
  dirty: boolean;
  startupComplete: boolean;
  restoredProjectRoot: string | null;
  mode: EditorMode;
  backendProjectRoot: string | null;
  backendProjectGeneration: number | null;
  watcherRoot: string | null;
  watcherGeneration: number | null;
  watcherActive: boolean;
  lastFocusedWindow: string | null;
}

export class DebugBridgeError extends Error {
  constructor(slice: string) {
    super(
      `Debug bridge "${slice}" called before its provider connected. ` +
        "This usually means a debug consumer ran before React mounted the app. " +
        "Provider connection happens in useAppDebug.",
    );
    this.name = "DebugBridgeError";
  }
}

let connectedApp: AppBridgeMethods | null = null;
let connectedEditor: EditorBridgeMethods | null = null;
let connectedLexical: LexicalEditor | null = null;
let connectedSourceMap: SourceMap | null = null;
let connectedTauriSmoke: TauriSmokeMethods | null = null;

function requireApp(): AppBridgeMethods {
  if (!connectedApp) throw new DebugBridgeError("__app");
  return connectedApp;
}

function requireEditor(): EditorBridgeMethods {
  if (!connectedEditor) throw new DebugBridgeError("__editor");
  return connectedEditor;
}

export function getConnectedApp(): AppBridgeMethods | null {
  return connectedApp;
}

export function getConnectedEditor(): EditorBridgeMethods | null {
  return connectedEditor;
}

export function getConnectedSourceMap(): SourceMap | null {
  return connectedSourceMap;
}

export function connectAppBridge(methods: AppBridgeMethods): void {
  connectedApp = methods;
}

export function disconnectAppBridge(): void {
  connectedApp = null;
}

export function connectEditorBridge(methods: EditorBridgeMethods | null): void {
  connectedEditor = methods;
}

export function connectLexicalEditor(editor: LexicalEditor | null): void {
  connectedLexical = editor;
}

export function connectSourceMap(sourceMap: SourceMap | null): void {
  connectedSourceMap = sourceMap;
}

export function connectTauriSmoke(methods: TauriSmokeMethods | null): void {
  connectedTauriSmoke = methods;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * Install eagerly-populated `window.__*` surfaces. Called once at module
 * load so any consumer (including those running before React mounts) sees
 * a fully-formed bridge shape.
 *
 * Methods delegate through the module's state. If no provider has connected,
 * they throw `DebugBridgeError`. Callers that want to probe for readiness
 * should use `getConnectedApp()` (returns `null` when disconnected).
 */
function installWindowBridge(): void {
  if (!isBrowser()) return;

  window.__app = {
    openFile: (path) => requireApp().openFile(path),
    hasFile: (path) => requireApp().hasFile(path),
    openFileWithContent: (name, content) =>
      requireApp().openFileWithContent(name, content),
    loadFixtureProject: (files, initialPath) => {
      const app = requireApp();
      if (!app.loadFixtureProject) {
        return Promise.reject(
          new DebugBridgeError("__app.loadFixtureProject"),
        );
      }
      return app.loadFixtureProject(files, initialPath);
    },
    saveFile: () => requireApp().saveFile(),
    closeFile: (options) => requireApp().closeFile(options),
    setSearchOpen: (open) => requireApp().setSearchOpen(open),
    setMode: (mode) => requireApp().setMode(mode),
    getMode: () => requireApp().getMode(),
    getProjectRoot: () => requireApp().getProjectRoot(),
    getCurrentDocument: () => requireApp().getCurrentDocument(),
    isDirty: () => requireApp().isDirty(),
  };

  window.__editor = {
    focus: () => requireEditor().focus(),
    getDoc: () => requireEditor().getDoc(),
    getSelection: () => requireEditor().getSelection(),
    insertText: (text) => requireEditor().insertText(text),
    setDoc: (doc) => requireEditor().setDoc(doc),
    setSelection: (anchor, focus) => requireEditor().setSelection(anchor, focus),
  };

  window.__cmView = {
    dispatch: () => {},
    get dom(): Element | null {
      return document.querySelector('[data-testid="lexical-editor"]');
    },
    focus: () => requireEditor().focus(),
    state: {
      doc: {
        toString: () => requireEditor().getDoc(),
      },
    },
  };

  window.__cmDebug = {
    dump: () => ({
      doc: requireEditor().getDoc(),
      selection: connectedEditor ? connectedEditor.getSelection() : null,
    }),
    line: (lineNumber) =>
      requireEditor().getDoc().split("\n")[lineNumber - 1] ?? null,
    selection: () => (connectedEditor ? connectedEditor.getSelection() : null),
    tree: () => {
      const active = getActiveEditor() ?? connectedLexical;
      return active ? readLexicalTree(active) : "";
    },
    treeString: () => {
      const active = getActiveEditor() ?? connectedLexical;
      return active ? readLexicalTree(active) : "";
    },
  };

  window.__cfDebug = {
    perfSummary: () => {
      throw new DebugBridgeError("__cfDebug.perfSummary");
    },
    printPerfSummary: () => {
      throw new DebugBridgeError("__cfDebug.printPerfSummary");
    },
    clearPerf: () => {
      throw new DebugBridgeError("__cfDebug.clearPerf");
    },
    togglePerfPanel: () => {
      throw new DebugBridgeError("__cfDebug.togglePerfPanel");
    },
    toggleFps: () => {
      throw new DebugBridgeError("__cfDebug.toggleFps");
    },
  };

  Object.defineProperty(window, "__cfSourceMap", {
    configurable: true,
    get(): SourceMap | null {
      return connectedSourceMap;
    },
  });

  Object.defineProperty(window, "__tauriSmoke", {
    configurable: true,
    get(): TauriSmokeMethods | undefined {
      return connectedTauriSmoke ?? undefined;
    },
  });
}

export interface PerfBridgeMethods {
  perfSummary: () => Promise<unknown>;
  printPerfSummary: () => Promise<unknown>;
  clearPerf: () => Promise<void>;
  togglePerfPanel: () => void;
  toggleFps: () => boolean;
}

export function connectPerfBridge(methods: PerfBridgeMethods): void {
  if (!isBrowser()) return;
  window.__cfDebug = {
    perfSummary: methods.perfSummary,
    printPerfSummary: methods.printPerfSummary,
    clearPerf: methods.clearPerf,
    togglePerfPanel: methods.togglePerfPanel,
    toggleFps: methods.toggleFps,
  };
}

installWindowBridge();
