import { useEffect, useRef } from "react";
import type { LexicalEditor } from "lexical";
import type { EditorMode } from "../editor-mode";
import type { MarkdownEditorHandle } from "../../lexical/markdown-editor-types";
import { isTauri } from "../../lib/tauri";
import { recordDebugSessionEvent } from "../../debug/session-recorder";
import type { SourceMap } from "../source-map";
import { getActiveEditor } from "../../lexical/active-editor-tracker";
import { readLexicalTree } from "../../lexical/tree-print";
import {
  clearCombinedPerf,
  getCombinedPerfSnapshot,
  printPerfSummary,
  togglePerfPanel,
} from "../perf";
import { setFpsMeterEnabled, stopFpsMeter } from "../fps-meter";
import { useDevSettings } from "../dev-settings";
import {
  debugEmitFileChangedCommand,
  debugGetNativeStateCommand,
  debugListWindowsCommand,
} from "../tauri-client/debug";

export interface DebugDocumentState {
  path: string;
  name: string;
  dirty: boolean;
}

export type DebugProjectFile =
  | { path: string; kind: "text"; content: string }
  | { path: string; kind: "binary"; base64: string };

interface TauriSmokeWindowState {
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
    window.__app = {
      openFile: async (path) => {
        recordDebugSessionEvent({
          timestamp: Date.now(),
          type: "app",
          summary: `openFile ${path}`,
          detail: { path },
        });
        await openFile(path);
      },
      hasFile: async (path) => hasFile(path),
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
        await openFileWithContent(name, content);
      },
      loadFixtureProject: loadFixtureProject
        ? async (files, initialPath) => {
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
            await loadFixtureProject(files, initialPath);
          }
        : undefined,
      saveFile: async () => {
        recordDebugSessionEvent({
          timestamp: Date.now(),
          type: "app",
          summary: "saveFile",
        });
        await saveFile();
      },
      closeFile: async (options) => {
        recordDebugSessionEvent({
          timestamp: Date.now(),
          type: "app",
          summary: "closeFile",
          detail: options ?? null,
        });
        return closeFile(options);
      },
      setSearchOpen: (open) => {
        recordDebugSessionEvent({
          timestamp: Date.now(),
          type: "app",
          summary: `setSearchOpen ${open ? "open" : "closed"}`,
          detail: { open },
        });
        setSearchOpen(open);
      },
      setMode: (nextMode) => {
        recordDebugSessionEvent({
          timestamp: Date.now(),
          type: "app",
          summary: `setMode ${nextMode}`,
          detail: { mode: nextMode },
        });
        setMode(nextMode);
      },
      getMode,
      getProjectRoot: () => projectRoot,
      getCurrentDocument: () => currentDocument,
      isDirty: () => hasDirtyDocument,
    };
    window.__editor = editorHandle
      ? {
          focus: () => {
            recordDebugSessionEvent({
              timestamp: Date.now(),
              type: "app",
              summary: "editor.focus",
            });
            editorHandle.focus();
          },
          getDoc: () => getCurrentDocText(),
          getSelection: () => editorHandle.getSelection(),
          insertText: (text) => {
            recordDebugSessionEvent({
              timestamp: Date.now(),
              type: "app",
              summary: `editor.insertText ${text.length}`,
              detail: { text },
            });
            editorHandle.insertText(text);
          },
          setDoc: (doc) => {
            recordDebugSessionEvent({
              timestamp: Date.now(),
              type: "app",
              summary: `editor.setDoc ${doc.length}`,
              detail: { docLength: doc.length },
            });
            editorHandle.setDoc(doc);
          },
          setSelection: (anchor, focus = anchor) => {
            recordDebugSessionEvent({
              timestamp: Date.now(),
              type: "app",
              summary: `editor.setSelection ${anchor}:${focus}`,
              detail: { anchor, focus },
            });
            editorHandle.setSelection(anchor, focus);
          },
        }
      : undefined;
    window.__cmView = {
      dispatch: () => {},
      dom: document.querySelector('[data-testid="lexical-editor"]'),
      focus: () => {
        editorHandle?.focus();
      },
      state: {
        doc: {
          toString: () => getCurrentDocText(),
        },
      },
    };
    window.__cfDebug = {
      perfSummary: getCombinedPerfSnapshot,
      printPerfSummary,
      clearPerf: clearCombinedPerf,
      togglePerfPanel,
      toggleFps: () => useDevSettings.getState().toggle("fpsCounter"),
    };
    window.__cmDebug = {
      dump: () => ({
        doc: getCurrentDocText(),
        selection: editorHandle?.getSelection() ?? null,
      }),
      line: (lineNumber: number) => getCurrentDocText().split("\n")[lineNumber - 1] ?? null,
      selection: () => editorHandle?.getSelection() ?? null,
      tree: () => {
        const active = getActiveEditor() ?? lexicalEditor;
        return active ? readLexicalTree(active) : "";
      },
      get treeString() { return this.tree; },
    };
    window.__cfSourceMap = getCurrentSourceMap();
    if (import.meta.env.DEV && isTauri()) {
      window.__tauriSmoke = {
        openProject,
        openFile,
        requestNativeClose,
        listWindows: () => debugListWindowsCommand(),
        getWindowState: async (): Promise<TauriSmokeWindowState> => {
          const nativeState = await debugGetNativeStateCommand();
          return {
            projectRoot,
            currentDocument,
            dirty: hasDirtyDocument,
            startupComplete,
            restoredProjectRoot,
            mode: getMode(),
            backendProjectRoot: nativeState.project_root,
            backendProjectGeneration: nativeState.project_generation,
            watcherRoot: nativeState.watcher_root,
            watcherGeneration: nativeState.watcher_generation,
            watcherActive: nativeState.watcher_active,
            lastFocusedWindow: nativeState.last_focused_window,
          };
        },
        simulateExternalChange: (relativePath: string, treeChanged?: boolean) =>
          debugEmitFileChangedCommand(relativePath, treeChanged),
      };
    } else {
      delete window.__tauriSmoke;
    }
    return () => {
      // Clear debug globals on unmount / HMR so stale closures are not left
      // on window between hot-reloads or component teardowns.
      delete window.__app;
      delete window.__editor;
      delete window.__cmView;
      delete window.__cmDebug;
      delete window.__cfDebug;
      delete window.__cfSourceMap;
      delete window.__tauriSmoke;
    };
  }, [
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
  ]);
}
