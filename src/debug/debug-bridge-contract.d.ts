import type { FormatEventDetail } from "../constants/events";
import type { EditorMode } from "../editor-display-mode";
import type {
  DebugDocumentState,
  FileWatcherStatus,
  MarkdownEditorSelection,
  ScrollGuardEvent,
  SidebarTab,
  WatcherHealthEvent,
} from "../lib/debug-types";
export type { DebugDocumentState } from "../lib/debug-types";
import type {
  DebugSessionCapture,
  DebugSessionExport,
  DebugSessionRecorderStatus,
} from "./session-recorder";
import type { EditorRuntimeContractSnapshot } from "./editor-runtime-contract";

export const CORE_DEBUG_GLOBAL_NAMES: readonly ["__app", "__cfDebug"];
export const DEBUG_BRIDGE_REQUIRED_GLOBAL_NAMES: readonly ["__app", "__editor", "__cfDebug"];
export const DEBUG_BRIDGE_READY_PROMISES: readonly [
  { readonly globalName: "__app"; readonly propertyName: "ready" },
  { readonly globalName: "__editor"; readonly propertyName: "ready" },
  { readonly globalName: "__cfDebug"; readonly propertyName: "ready" },
];
export const DEBUG_EDITOR_TEST_ID: "editor";
export const MODE_BUTTON_TEST_ID: "mode-button";
export const DEBUG_EDITOR_SELECTOR: "[data-testid=\"editor\"]";
export const MODE_BUTTON_SELECTOR: "[data-testid=\"mode-button\"]";
export const DEBUG_BRIDGE_DOC_ENTRIES: readonly (readonly [string, string])[];
export function formatDebugBridgeDocs(
  entries?: readonly (readonly [string, string])[],
): string;

export type DebugProjectFile =
  | { path: string; kind: "text"; content: string }
  | { path: string; kind: "binary"; base64: string };

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
  watcherHealth: WatcherHealthEvent | null;
  frontendWatcherStatus: FileWatcherStatus;
  lastFocusedWindow: string | null;
}

export interface AppDebugBridge {
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
}

export interface EditorDebugBridgeGlobal {
  ready: Promise<void>;
  focus: () => void;
  getDoc: () => string;
  getSelection: () => MarkdownEditorSelection;
  peekDoc: () => string;
  peekSelection: () => MarkdownEditorSelection;
  insertText: (text: string) => void;
  setDoc: (doc: string) => void;
  setSelection: (anchor: number, focus?: number) => void;
  formatSelection: (detail: FormatEventDetail) => boolean;
}

export interface CfDebugBridge {
  ready: Promise<void>;
  perfSummary: () => Promise<unknown>;
  printPerfSummary: () => Promise<unknown>;
  clearPerf: () => Promise<void>;
  togglePerfPanel: () => void;
  toggleFps: () => boolean;
  scrollGuards: () => readonly ScrollGuardEvent[];
  clearScrollGuards: () => void;
  watcherStatus: () => FileWatcherStatus;
  runtimeContract: () => Promise<EditorRuntimeContractSnapshot>;
  recorderStatus: () => DebugSessionRecorderStatus;
  captureState: (label?: string | null) => DebugSessionCapture;
  exportSession: (options?: { includeDocument?: boolean }) => unknown;
  clearSession: () => void;
  captureFullSession: (options?: {
    includeDocument?: boolean;
    label?: string | null;
  }) => Promise<CfDebugFullSession>;
  clearAllDebugBuffers: () => Promise<void>;
}

export interface CfDebugFullSession {
  readonly capturedAt: number;
  readonly capture: DebugSessionCapture;
  readonly perf: unknown;
  readonly session: DebugSessionExport;
}

export interface TauriSmokeBridge {
  openProject: (path: string) => Promise<boolean>;
  openFile: (path: string) => Promise<void>;
  requestNativeClose: () => Promise<void>;
  listWindows: () => Promise<Array<{ label: string; focused: boolean }>>;
  getWindowState: () => Promise<TauriSmokeWindowState>;
  simulateExternalChange: (relativePath: string, treeChanged?: boolean) => Promise<void>;
}
