/**
 * Ambient Window augmentation for Coflat debug globals.
 *
 * These properties are set at runtime by various subsystems and consumed
 * by browser console sessions, Playwright tests, and other debug tooling.
 * Declaring them here avoids unsafe `as unknown as` double-casts throughout
 * the codebase.
 *
 * See CLAUDE.md "Debug helpers" for usage documentation.
 */

import type { EditorView } from "@codemirror/view";
import type { DebugHelpers } from "../editor";
import type { SourceMap } from "../app/source-map";
import type { EditorMode } from "../editor";

declare global {
  interface Window {
    /**
     * The active CM6 EditorView instance.
     * Set by useEditorDebugBridge; cleared on unmount.
     */
    __cmView?: EditorView;

    /**
     * Debug helper functions for the active editor.
     * Set by useEditorDebugBridge; cleared on unmount.
     */
    __cmDebug?: DebugHelpers;

    /**
     * Source map for include expansion.
     * Set by useEditorDocumentServices when includes are expanded.
     */
    __cfSourceMap?: SourceMap | null;

    /**
     * Toggle flag for fenced-div parser tracing.
     * Set `true` in the console to enable verbose parser logging.
     */
    __fencedDivDebug?: boolean;

    /**
     * App-level debug helpers exposed for console and Playwright testing.
     * Set by useAppDebug; cleared on unmount.
     */
    __app?: {
      openFile: (path: string) => Promise<void>;
      saveFile: () => Promise<void>;
      closeFile: (options?: { discard?: boolean }) => Promise<boolean>;
      setSearchOpen: (open: boolean) => void;
      setMode: (mode: EditorMode) => void;
      getMode: () => EditorMode;
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
      simulateExternalChange: (relativePath: string) => Promise<void>;
    };
  }
}
