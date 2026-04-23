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
import type { DebugHelpers, DebugRenderState } from "../editor";
import type { EditorMode } from "../editor-display-mode";
import type { DebugDocumentState, DebugProjectFile } from "../app/hooks/use-app-debug";
import type { SidebarTab } from "../app/hooks/use-sidebar-layout";
import type { ScrollGuardEvent } from "../app/hooks/use-editor-scroll";
import type {
  DebugSessionCapture,
  DebugSessionRecorderStatus,
} from "../debug/session-recorder";

declare global {
  interface Window {
    /**
     * The active CM6 EditorView instance.
     * Set by useEditorDebugBridge; cleared on unmount.
     */
    __cmView?: EditorView;

    /**
     * Debug helper functions for the active editor, including stable
     * rich-mode vertical motion, measured geometry snapshots, recent
     * motion-guard history, and explicit structure-edit helpers used by
     * browser regressions.
     * Set by useEditorDebugBridge; cleared on unmount.
     */
    __cmDebug?: DebugHelpers;

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
      ready: Promise<void>;
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
      showSidebarPanel: (panel: SidebarTab) => void;
      getSidebarState: () => {
        collapsed: boolean;
        tab: SidebarTab;
      };
      setMode: (mode: EditorMode | string) => void;
      getMode: () => EditorMode;
      getProjectRoot: () => string | null;
      getCurrentDocument: () => DebugDocumentState | null;
      isDirty: () => boolean;
    };

    /**
     * Product-neutral editor debug bridge. CM6 mode delegates to the
     * active `EditorView`; Lexical mode delegates to the active
     * `MarkdownEditorHandle`.
     */
    __editor?: {
      ready: Promise<void>;
      focus: () => void;
      getDoc: () => string;
      getSelection: () => import("../lexical/markdown-editor-types").MarkdownEditorSelection;
      peekDoc: () => string;
      peekSelection: () => import("../lexical/markdown-editor-types").MarkdownEditorSelection;
      insertText: (text: string) => void;
      setDoc: (doc: string) => void;
      setSelection: (anchor: number, focus?: number) => void;
      formatSelection: (detail: import("../constants/events").FormatEventDetail) => boolean;
    };

    /**
     * Performance debug helpers.
     * Set by useAppDebug; cleared on unmount.
     */
    __cfDebug?: {
      ready: Promise<void>;
      perfSummary: () => Promise<unknown>;
      printPerfSummary: () => Promise<unknown>;
      clearPerf: () => Promise<void>;
      togglePerfPanel: () => void;
      toggleFps: () => boolean;
      scrollGuards: () => readonly ScrollGuardEvent[];
      clearScrollGuards: () => void;
      renderState: () => DebugRenderState | null;
      recorderStatus: () => DebugSessionRecorderStatus;
      captureState: (label?: string | null) => DebugSessionCapture;
      interactionLog: () => readonly import("../lexical/interaction-trace").InteractionTraceEntry[];
      clearInteractionLog: () => void;
      exportSession: (options?: { includeDocument?: boolean }) => unknown;
      clearSession: () => void;
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
