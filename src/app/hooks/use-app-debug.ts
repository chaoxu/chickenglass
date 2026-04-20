import { useEffect, useRef } from "react";
import type { LexicalEditor } from "lexical";
import type { EditorMode } from "../editor-mode";
import type { MarkdownEditorHandle } from "../../lexical/markdown-editor-types";
import { isTauri } from "../../lib/tauri";
import {
  clearDebugSessionEvents,
  exportDebugSessionEvents,
  recordDebugSessionEvent,
} from "../../debug/session-recorder";
import type { SourceMap } from "../source-map";
import {
  clearCombinedPerf,
  getCombinedPerfSnapshot,
  printPerfSummary,
  togglePerfPanel,
} from "../perf";
import { setFpsMeterEnabled, stopFpsMeter } from "../fps-meter";
import { getInteractionLog, clearInteractionLog } from "../../lexical/interaction-trace";
import { useDevSettings } from "../../state/dev-settings";
import {
  debugEmitFileChangedCommand,
  debugGetNativeStateCommand,
  debugListWindowsCommand,
} from "../tauri-client/debug";
import {
  connectAppBridge,
  connectEditorBridge,
  connectLexicalEditor,
  connectPerfBridge,
  connectSourceMapProvider,
  connectTauriSmoke,
  disconnectAppBridge,
  type TauriSmokeWindowState,
} from "../../debug/debug-bridge";
import type {
  DebugDocumentState,
  DebugProjectFile,
} from "./use-app-debug-types";

export type { DebugDocumentState, DebugProjectFile } from "./use-app-debug-types";

interface AppDebugDeps {
  editorHandle: MarkdownEditorHandle | null;
  lexicalEditor: LexicalEditor | null;
  openProject: (path: string) => Promise<boolean>;
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
  requestNativeClose: () => Promise<void>;
  setMode: (mode: EditorMode) => void;
  getMode: () => EditorMode;
  getCurrentDocText: () => string;
  getCurrentSourceMap: () => SourceMap | null;
  projectRoot: string | null;
  currentDocument: DebugDocumentState | null;
  hasDirtyDocument: boolean;
  startupComplete: boolean;
  restoredProjectRoot: string | null;
}

type AppDebugSnapshot = AppDebugDeps & {
  readonly mode: EditorMode;
};

export function useAppDebug({
  editorHandle,
  lexicalEditor,
  openProject,
  openFile,
  hasFile,
  openFileWithContent,
  loadFixtureProject,
  saveFile,
  closeFile,
  setSearchOpen,
  requestNativeClose,
  setMode,
  getMode,
  getCurrentDocText,
  getCurrentSourceMap,
  projectRoot,
  currentDocument,
  hasDirtyDocument,
  startupComplete,
  restoredProjectRoot,
}: AppDebugDeps): void {
  const lastAppStateRef = useRef<string | null>(null);
  const mode = getMode();
  const depsRef = useRef<AppDebugSnapshot | null>(null);
  depsRef.current = {
    editorHandle,
    lexicalEditor,
    openProject,
    openFile,
    hasFile,
    openFileWithContent,
    loadFixtureProject,
    saveFile,
    closeFile,
    setSearchOpen,
    requestNativeClose,
    setMode,
    getMode,
    getCurrentDocText,
    getCurrentSourceMap,
    projectRoot,
    currentDocument,
    hasDirtyDocument,
    startupComplete,
    restoredProjectRoot,
    mode,
  };

  // Stop the FPS rAF loop only on true unmount / HMR — not on every effect
  // refresh caused by dependency changes (openProject, currentDocument, etc.).
  useEffect(() => () => stopFpsMeter(), []);

  // Sync the FPS meter module with the fpsCounter dev setting.
  useEffect(() => {
    let prev = useDevSettings.getState().fpsCounter;
    return useDevSettings.subscribe((state) => {
      if (state.fpsCounter !== prev) {
        prev = state.fpsCounter;
        setFpsMeterEnabled(state.fpsCounter);
      }
    });
  }, []);

  useEffect(() => {
    const snapshot = JSON.stringify({
      projectRoot,
      currentDocument,
      dirty: hasDirtyDocument,
      startupComplete,
      restoredProjectRoot,
      mode,
    });
    if (snapshot === lastAppStateRef.current) return;
    lastAppStateRef.current = snapshot;
    recordDebugSessionEvent({
      timestamp: Date.now(),
      type: "app",
      summary: `app ${currentDocument?.path ?? "(no document)"} ${mode}`,
      detail: JSON.parse(snapshot) as unknown,
    });
  }, [
    projectRoot,
    currentDocument,
    hasDirtyDocument,
    startupComplete,
    restoredProjectRoot,
    mode,
  ]);

  useEffect(() => {
    const current = () => {
      if (!depsRef.current) {
        throw new Error("Debug bridge provider used before app debug state initialized.");
      }
      return depsRef.current;
    };
    const currentEditorHandle = () => {
      const handle = current().editorHandle;
      if (!handle) {
        throw new Error("Debug editor bridge called before an editor handle is available.");
      }
      return handle;
    };

    connectAppBridge({
      openFile: async (path) => {
        recordDebugSessionEvent({
          timestamp: Date.now(),
          type: "app",
          summary: `openFile ${path}`,
          detail: { path },
        });
        await current().openFile(path);
      },
      hasFile: async (path) => current().hasFile(path),
      openFileWithContent: async (name, content) => {
        recordDebugSessionEvent({
          timestamp: Date.now(),
          type: "app",
          summary: `openFileWithContent ${name}`,
          detail: {
            name,
            contentLength: content.length,
            content,
          },
        });
        await current().openFileWithContent(name, content);
      },
      loadFixtureProject: async (files, initialPath) => {
        const load = current().loadFixtureProject;
        if (!load) {
          throw new Error("Debug fixture project loading is not available in this app mode.");
        }
        recordDebugSessionEvent({
          timestamp: Date.now(),
          type: "app",
          summary: `loadFixtureProject ${initialPath ?? "(no initial file)"}`,
          detail: {
            initialPath: initialPath ?? null,
            fileCount: files.length,
            files,
          },
        });
        await load(files, initialPath);
      },
      saveFile: async () => {
        recordDebugSessionEvent({
          timestamp: Date.now(),
          type: "app",
          summary: "saveFile",
        });
        await current().saveFile();
      },
      closeFile: async (options) => {
        recordDebugSessionEvent({
          timestamp: Date.now(),
          type: "app",
          summary: "closeFile",
          detail: options ?? null,
        });
        return current().closeFile(options);
      },
      setSearchOpen: (open) => {
        recordDebugSessionEvent({
          timestamp: Date.now(),
          type: "app",
          summary: `setSearchOpen ${open ? "open" : "closed"}`,
          detail: { open },
        });
        current().setSearchOpen(open);
      },
      setMode: (nextMode) => {
        recordDebugSessionEvent({
          timestamp: Date.now(),
          type: "app",
          summary: `setMode ${nextMode}`,
          detail: { mode: nextMode },
        });
        current().setMode(nextMode);
      },
      getMode: () => current().getMode(),
      getProjectRoot: () => current().projectRoot,
      getCurrentDocument: () => current().currentDocument,
      isDirty: () => current().hasDirtyDocument,
    });

    connectEditorBridge({
      focus: () => {
        recordDebugSessionEvent({
          timestamp: Date.now(),
          type: "app",
          summary: "editor.focus",
        });
        currentEditorHandle().focus();
      },
      getDoc: () => current().getCurrentDocText(),
      getSelection: () => currentEditorHandle().getSelection(),
      peekDoc: () => currentEditorHandle().peekDoc(),
      peekSelection: () => currentEditorHandle().peekSelection(),
      insertText: (text) => {
        recordDebugSessionEvent({
          timestamp: Date.now(),
          type: "app",
          summary: `editor.insertText ${text.length}`,
          detail: { text },
        });
        currentEditorHandle().insertText(text);
      },
      setDoc: (doc) => {
        recordDebugSessionEvent({
          timestamp: Date.now(),
          type: "app",
          summary: `editor.setDoc ${doc.length}`,
          detail: { docLength: doc.length },
        });
        currentEditorHandle().setDoc(doc);
      },
      setSelection: (anchor, focus = anchor) => {
        recordDebugSessionEvent({
          timestamp: Date.now(),
          type: "app",
          summary: `editor.setSelection ${anchor}:${focus}`,
          detail: { anchor, focus },
        });
        currentEditorHandle().setSelection(anchor, focus);
      },
    });

    connectSourceMapProvider(() => current().getCurrentSourceMap());

    connectPerfBridge({
      perfSummary: getCombinedPerfSnapshot,
      printPerfSummary,
      clearPerf: clearCombinedPerf,
      togglePerfPanel,
      toggleFps: () => useDevSettings.getState().toggle("fpsCounter"),
      interactionLog: getInteractionLog,
      clearInteractionLog,
      exportSession: exportDebugSessionEvents,
      clearSession: clearDebugSessionEvents,
    });
    if (import.meta.env.DEV && isTauri()) {
      connectTauriSmoke({
        openProject: (path) => current().openProject(path),
        openFile: (path) => current().openFile(path),
        requestNativeClose: () => current().requestNativeClose(),
        listWindows: () => debugListWindowsCommand(),
        getWindowState: async (): Promise<TauriSmokeWindowState> => {
          const nativeState = await debugGetNativeStateCommand();
          const snapshot = current();
          return {
            projectRoot: snapshot.projectRoot,
            currentDocument: snapshot.currentDocument,
            dirty: snapshot.hasDirtyDocument,
            startupComplete: snapshot.startupComplete,
            restoredProjectRoot: snapshot.restoredProjectRoot,
            mode: snapshot.getMode(),
            backendProjectRoot: nativeState.projectRoot,
            backendProjectGeneration: nativeState.projectGeneration,
            watcherRoot: nativeState.watcherRoot,
            watcherGeneration: nativeState.watcherGeneration,
            watcherActive: nativeState.watcherActive,
            lastFocusedWindow: nativeState.lastFocusedWindow,
          };
        },
        simulateExternalChange: (relativePath: string, treeChanged?: boolean) =>
          debugEmitFileChangedCommand(relativePath, treeChanged),
      });
    } else {
      connectTauriSmoke(null);
    }

    return () => {
      // Disconnect on unmount / HMR so stale closures are not left active on
      // the bridge between hot-reloads or component teardowns. The window.__*
      // surfaces remain shaped; calling them will throw DebugBridgeError.
      disconnectAppBridge();
      connectEditorBridge(null);
      connectSourceMapProvider(null);
      connectTauriSmoke(null);
    };
  }, []);

  useEffect(() => {
    connectLexicalEditor(lexicalEditor);
    return () => {
      connectLexicalEditor(null);
    };
  }, [lexicalEditor]);
}
