/**
 * Ambient Window augmentation for Coflat debug globals.
 *
 * These properties are set at runtime by various subsystems and consumed
 * by browser console sessions, Playwright tests, and other debug tooling.
 * Declaring them here avoids unsafe `as unknown as` double-casts throughout
 * the codebase.
 *
 */

import type { SourceMap } from "../app/source-map";
import type { EditorMode } from "../app/editor-mode";
import type { DebugDocumentState, DebugProjectFile } from "../app/hooks/use-app-debug";

declare global {
  interface Window {
    /**
     * Source map for include expansion.
     * Set by useEditorDocumentServices when includes are expanded.
     */
    __cfSourceMap?: SourceMap | null;

    /**
     * App-level debug helpers exposed for console and Playwright testing.
     * Set by useAppDebug; cleared on unmount.
     */
    __app?: {
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
    };

    /**
     * Editor-level debug helpers exposed for browser automation and console use.
     * Present only when a document editor surface is mounted.
     */
    __editor?: {
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
    };

    __cmView?: {
      dispatch: (...args: unknown[]) => void;
      dom: Element | null;
      focus: () => void;
      state: {
        doc: {
          toString: () => string;
        };
      };
    };

    __cmDebug?: {
      dump: () => {
        doc: string;
        selection: {
          anchor: number;
          focus: number;
          from: number;
          to: number;
        } | null;
      };
      line: (lineNumber: number) => string | null;
      selection: () => {
        anchor: number;
        focus: number;
        from: number;
        to: number;
      } | null;
      tree: () => string;
      treeString: () => string;
    };

    /**
     * Performance debug helpers.
     * Set by useAppDebug; cleared on unmount.
     */
    __cfDebug?: {
      perfSummary: () => Promise<unknown>;
      printPerfSummary: () => Promise<unknown>;
      clearPerf: () => Promise<void>;
      togglePerfPanel: () => void;
      toggleFps: () => boolean;
    };

    /**
     * Dev-only native smoke helpers exposed in Tauri debug builds.
     * Set by useAppDebug; cleared on unmount.
     */
    __tauriSmoke?: {
      openProject: (path: string) => Promise<boolean>;
      openFile: (path: string) => Promise<void>;
      requestNativeClose: () => Promise<void>;
      listWindows: () => Promise<Array<{ label: string; focused: boolean }>>;
      getWindowState: () => Promise<{
        projectRoot: string | null;
        currentDocument: { path: string; name: string; dirty: boolean } | null;
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
      }>;
      simulateExternalChange: (relativePath: string, treeChanged?: boolean) => Promise<void>;
    };
  }
}
