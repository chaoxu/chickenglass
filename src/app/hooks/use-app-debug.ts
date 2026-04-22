import { useEffect, useRef } from "react";
import type { FormatEventDetail } from "../../constants/events";
import type { EditorMode } from "../../editor-display-mode";
import { isTauri } from "../../lib/tauri";
import {
  captureDebugSessionState,
  clearDebugSessionEvents,
  exportDebugSessionEvents,
  getDebugSessionRecorderStatus,
  recordDebugSessionEvent,
} from "../../debug/session-recorder";
import {
  clearScrollGuardEvents,
  getScrollGuardEvents,
} from "./use-editor-scroll";
import {
  clearCombinedPerf,
  getCombinedPerfSnapshot,
  printPerfSummary,
  togglePerfPanel,
} from "../perf";
import { setFpsMeterEnabled, stopFpsMeter } from "../fps-meter";
import { useDevSettings } from "../../state/dev-settings";
import { clearInteractionLog, getInteractionLog } from "../../lexical/interaction-trace";
import type { MarkdownEditorHandle, MarkdownEditorSelection } from "../../lexical/markdown-editor-types";
import { planMarkdownFormat } from "../format-markdown";
import {
  debugEmitFileChangedCommand,
  debugGetNativeStateCommand,
  debugListWindowsCommand,
} from "../tauri-client/debug";
import {
  getDebugBridgeReadyPromise,
  markDebugBridgeReady,
} from "../../debug/debug-bridge-ready";

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
  getCurrentDocText: () => string;
  getLexicalEditorHandle: () => MarkdownEditorHandle | null;
  setSearchOpen: (open: boolean) => void;
  requestNativeClose: () => Promise<void>;
  setMode: (mode: EditorMode | string) => void;
  getMode: () => EditorMode;
  projectRoot: string | null;
  currentDocument: DebugDocumentState | null;
  hasDirtyDocument: boolean;
  startupComplete: boolean;
  restoredProjectRoot: string | null;
}

export function useAppDebug({
  openProject,
  openFile,
  hasFile,
  openFileWithContent,
  loadFixtureProject,
  saveFile,
  closeFile,
  getCurrentDocText,
  getLexicalEditorHandle,
  setSearchOpen,
  requestNativeClose,
  setMode,
  getMode,
  projectRoot,
  currentDocument,
  hasDirtyDocument,
  startupComplete,
  restoredProjectRoot,
}: AppDebugDeps): void {
  const lastAppStateRef = useRef<string | null>(null);
  const mode = getMode();

  const summarizeDebugProjectFile = (file: DebugProjectFile) =>
    file.kind === "text"
      ? {
          path: file.path,
          kind: file.kind,
          contentLength: file.content.length,
        }
      : {
          path: file.path,
          kind: file.kind,
          base64Length: file.base64.length,
        };

  const getEditorHandle = () => getLexicalEditorHandle();

  const getCmView = () => window.__cmView ?? null;

  const readEditorDoc = (): string => {
    const handle = getEditorHandle();
    if (handle) {
      return handle.getDoc();
    }
    const view = getCmView();
    return view ? view.state.doc.toString() : getCurrentDocText();
  };

  const peekEditorDoc = (): string => {
    const handle = getEditorHandle();
    if (handle) {
      return handle.peekDoc();
    }
    const view = getCmView();
    return view ? view.state.doc.toString() : getCurrentDocText();
  };

  const readEditorSelection = (): MarkdownEditorSelection => {
    const handle = getEditorHandle();
    if (handle) {
      return handle.getSelection();
    }
    const view = getCmView();
    if (!view) {
      return { anchor: 0, focus: 0, from: 0, to: 0 };
    }
    const selection = view.state.selection.main;
    return {
      anchor: selection.anchor,
      focus: selection.head,
      from: selection.from,
      to: selection.to,
    };
  };

  const focusEditor = () => {
    const handle = getEditorHandle();
    if (handle) {
      handle.focus();
      return;
    }
    getCmView()?.focus();
  };

  const insertEditorText = (text: string) => {
    const handle = getEditorHandle();
    if (handle) {
      handle.insertText(text);
      return;
    }
    const view = getCmView();
    if (!view) return;
    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + text.length },
    });
  };

  const setEditorDoc = (doc: string) => {
    const handle = getEditorHandle();
    if (handle) {
      handle.setDoc(doc);
      return;
    }
    const view = getCmView();
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: doc },
      selection: { anchor: Math.min(view.state.selection.main.head, doc.length) },
    });
  };

  const setEditorSelection = (anchor: number, focus?: number) => {
    const handle = getEditorHandle();
    if (handle) {
      handle.setSelection(anchor, focus);
      return;
    }
    const view = getCmView();
    if (!view) return;
    view.dispatch({
      selection: { anchor, head: focus ?? anchor },
      scrollIntoView: true,
    });
  };

  const formatEditorSelection = (detail: FormatEventDetail): boolean => {
    const handle = getEditorHandle();
    if (handle) {
      const plan = planMarkdownFormat(
        getCurrentDocText(),
        handle.getSelection(),
        detail,
      );
      handle.applyChanges(plan.changes);
      handle.setSelection(plan.selection.anchor, plan.selection.focus);
      handle.focus();
      return true;
    }
    const view = getCmView();
    if (!view) return false;
    const selection = view.state.selection.main;
    const plan = planMarkdownFormat(
      view.state.doc.toString(),
      {
        anchor: selection.anchor,
        focus: selection.head,
        from: selection.from,
        to: selection.to,
      },
      detail,
    );
    view.dispatch({
      changes: [...plan.changes],
      selection: {
        anchor: plan.selection.anchor,
        head: plan.selection.focus,
      },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  };

  // Stop the FPS rAF loop only on true unmount / HMR — not on every effect
  // refresh caused by dependency changes (openProject, currentDocument, etc.).
  useEffect(() => () => stopFpsMeter(), []);

  useEffect(() => {
    let previous = useDevSettings.getState().fpsCounter;
    setFpsMeterEnabled(previous);
    return useDevSettings.subscribe((state) => {
      if (state.fpsCounter === previous) {
        return;
      }
      previous = state.fpsCounter;
      setFpsMeterEnabled(state.fpsCounter);
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
      ready: getDebugBridgeReadyPromise("app"),
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
            contentPreview: content.slice(0, 120),
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
                files: files.map(summarizeDebugProjectFile),
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
    markDebugBridgeReady("app");
    window.__editor = {
      ready: getDebugBridgeReadyPromise("editor"),
      focus: focusEditor,
      getDoc: readEditorDoc,
      getSelection: readEditorSelection,
      peekDoc: peekEditorDoc,
      peekSelection: readEditorSelection,
      insertText: insertEditorText,
      setDoc: setEditorDoc,
      setSelection: setEditorSelection,
      formatSelection: formatEditorSelection,
    };
    markDebugBridgeReady("editor");
    window.__cfDebug = {
      ready: getDebugBridgeReadyPromise("cfDebug"),
      perfSummary: getCombinedPerfSnapshot,
      printPerfSummary,
      clearPerf: clearCombinedPerf,
      togglePerfPanel,
      toggleFps: () => useDevSettings.getState().toggle("fpsCounter"),
      scrollGuards: () => getScrollGuardEvents(),
      clearScrollGuards: () => clearScrollGuardEvents(),
      renderState: () => window.__cmDebug?.renderState?.() ?? null,
      recorderStatus: () => getDebugSessionRecorderStatus(),
      captureState: (label?: string | null) => captureDebugSessionState(label),
      interactionLog: getInteractionLog,
      clearInteractionLog,
      exportSession: (options?: { includeDocument?: boolean }) =>
        exportDebugSessionEvents({
          currentDocument: options?.includeDocument === false ? null : getCurrentDocText(),
        }),
      clearSession: clearDebugSessionEvents,
    };
    markDebugBridgeReady("cfDebug");
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
      delete window.__cfDebug;
      delete window.__tauriSmoke;
    };
  }, [
    openProject,
    openFile,
    hasFile,
    openFileWithContent,
    loadFixtureProject,
    saveFile,
    closeFile,
    getCurrentDocText,
    getLexicalEditorHandle,
    setSearchOpen,
    requestNativeClose,
    setMode,
    getMode,
    projectRoot,
    currentDocument,
    hasDirtyDocument,
    startupComplete,
    restoredProjectRoot,
    mode,
  ]);
}
