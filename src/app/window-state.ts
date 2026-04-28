/**
 * Window state persistence module.
 *
 * Saves and restores:
 * - The current project root
 * - The current document path
 * - Sidebar collapsed state per section
 * - Sidebar width
 *
 * State is persisted to localStorage under a per-window key derived from
 * `cf-window-state`.
 */

import { basename, readLocalStorage, writeLocalStorage } from "./lib/utils";
import { WINDOW_STATE_KEY } from "../constants";
import type { SidebarTab } from "../lib/debug-types";
import { isTauri } from "../lib/tauri";
import {
  emitLocalStorageKeyChange,
  subscribeLocalStorageKey,
} from "./stores/local-storage-subscription";

/** Persisted state for the current document. */
export interface CurrentDocumentState {
  /** Project-relative file path. */
  path: string;
  /** Display name cached from last session. */
  name: string;
}

/** Persisted state for a collapsible sidebar section. */
export interface SidebarSectionState {
  /** Section title used as the key. */
  title: string;
  /** Whether the section is collapsed. */
  collapsed: boolean;
}

/** Canonical persisted layout state for the editor workspace. */
export interface WorkspaceLayoutState {
  /** Whether the left sidebar is collapsed. */
  sidebarCollapsed: boolean;
  /** Last expanded sidebar width in pixels. */
  sidebarWidth: number;
  /** Active sidebar panel. */
  sidebarTab: SidebarTab;
  /** Whether the document sidenote rail is collapsed. */
  sidenotesCollapsed: boolean;
}

/** Full persisted window state. */
export interface WindowState {
  /** Current project root in Tauri mode, or null in browser/demo mode. */
  projectRoot: string | null;
  /** The single document currently open in this window. */
  currentDocument: CurrentDocumentState | null;
  /** Canonical persisted workspace layout. */
  layout: WorkspaceLayoutState;
  /** Schema version for forward compatibility. */
  version: 3;
}

interface LegacyV2WindowState {
  projectRoot: string | null;
  currentDocument: CurrentDocumentState | null;
  sidebarWidth: number;
  sidebarSections: SidebarSectionState[];
  version: 2;
}

const STATE_VERSION = 3;
const PREVIOUS_STATE_VERSION = 2;
const WINDOW_LAUNCH_PROJECT_ROOT_PARAM = "projectRoot";
const WINDOW_LAUNCH_FILE_PARAM = "file";

/** Default state used when no persisted state is found. */
export const DEFAULT_WORKSPACE_LAYOUT_STATE: WorkspaceLayoutState = {
  sidebarCollapsed: false,
  sidebarWidth: 220,
  sidebarTab: "files",
  sidenotesCollapsed: true,
};

const DEFAULT_STATE: WindowState = {
  projectRoot: null,
  currentDocument: null,
  layout: DEFAULT_WORKSPACE_LAYOUT_STATE,
  version: STATE_VERSION,
};

let windowStateSnapshot: WindowState | null = null;
let windowStateStorageSignature: string | null = null;

function readWindowStateStorageSignature(): string {
  const storageKey = getWindowStateStorageKey();
  try {
    return JSON.stringify({
      storageKey,
      scoped: localStorage.getItem(storageKey),
      fallback: storageKey === WINDOW_STATE_KEY ? null : localStorage.getItem(WINDOW_STATE_KEY),
      href: typeof window === "undefined" ? "" : window.location.href,
    });
  } catch (_error) {
    return storageKey;
  }
}

/**
 * Read the Tauri window label directly from TAURI_INTERNALS.
 *
 * This avoids a static import of `@tauri-apps/api/window` which would pull
 * the entire Tauri window module into the browser startup bundle (#446).
 * The label is a synchronous read from the global Tauri metadata object.
 */
function getCurrentWindowLabel(): string | null {
  if (!isTauri()) return null;
  try {
    const internals = (window as Window & { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__;
    return internals?.metadata?.currentWindow?.label ?? null;
  } catch (_error) {
    return null;
  }
}

export function getWindowStateStorageKey(
  windowLabel: string | null = getCurrentWindowLabel(),
): string {
  return windowLabel ? `${WINDOW_STATE_KEY}:${windowLabel}` : WINDOW_STATE_KEY;
}

function isSidebarTab(value: unknown): value is SidebarTab {
  return value === "files" || value === "outline" || value === "diagnostics" || value === "runtime";
}

function normalizeLayoutState(value: unknown): WorkspaceLayoutState | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate["sidebarCollapsed"] !== "boolean") return null;
  if (typeof candidate["sidebarWidth"] !== "number") return null;
  if (!isSidebarTab(candidate["sidebarTab"])) return null;
  if (typeof candidate["sidenotesCollapsed"] !== "boolean") return null;

  return {
    sidebarCollapsed: candidate["sidebarCollapsed"],
    sidebarWidth: candidate["sidebarWidth"] > 0
      ? candidate["sidebarWidth"]
      : DEFAULT_WORKSPACE_LAYOUT_STATE.sidebarWidth,
    sidebarTab: candidate["sidebarTab"],
    sidenotesCollapsed: candidate["sidenotesCollapsed"],
  };
}

function layoutFromLegacySidebarWidth(sidebarWidth: number): WorkspaceLayoutState {
  return {
    ...DEFAULT_WORKSPACE_LAYOUT_STATE,
    sidebarCollapsed: sidebarWidth === 0,
    sidebarWidth: sidebarWidth > 0
      ? sidebarWidth
      : DEFAULT_WORKSPACE_LAYOUT_STATE.sidebarWidth,
  };
}

function parseV2WindowState(value: unknown): LegacyV2WindowState | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate["version"] !== PREVIOUS_STATE_VERSION) return null;
  if (typeof candidate["projectRoot"] !== "string" && candidate["projectRoot"] !== null) return null;
  if (!isCurrentDocumentState(candidate["currentDocument"])) return null;
  if (typeof candidate["sidebarWidth"] !== "number") return null;
  if (!Array.isArray(candidate["sidebarSections"])) return null;
  const sections = (candidate["sidebarSections"] as unknown[]).filter(isSidebarSectionState);
  if (sections.length !== (candidate["sidebarSections"] as unknown[]).length) return null;

  return {
    currentDocument: candidate["currentDocument"],
    projectRoot: candidate["projectRoot"] as string | null,
    sidebarWidth: candidate["sidebarWidth"],
    sidebarSections: sections,
    version: PREVIOUS_STATE_VERSION,
  };
}

function migrateWindowState(value: unknown): WindowState | null {
  if (isWindowState(value)) {
    return {
      ...value,
      layout: normalizeLayoutState(value.layout) ?? DEFAULT_WORKSPACE_LAYOUT_STATE,
    };
  }

  const previous = parseV2WindowState(value);
  if (previous) {
    return {
      projectRoot: previous.projectRoot,
      currentDocument: previous.currentDocument,
      layout: layoutFromLegacySidebarWidth(previous.sidebarWidth),
      version: STATE_VERSION,
    };
  }

  return null;
}

function consumeWindowLaunchStateFromUrl(): Partial<WindowState> | null {
  if (typeof window === "undefined") return null;

  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch (_error) {
    return null;
  }

  const projectRoot = url.searchParams.get(WINDOW_LAUNCH_PROJECT_ROOT_PARAM);
  const filePath = url.searchParams.get(WINDOW_LAUNCH_FILE_PARAM);
  if (!projectRoot && !filePath) {
    return null;
  }

  url.searchParams.delete(WINDOW_LAUNCH_PROJECT_ROOT_PARAM);
  url.searchParams.delete(WINDOW_LAUNCH_FILE_PARAM);
  try {
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch (_error) {
    // best-effort: keep startup robust even if history is unavailable
  }

  return {
    projectRoot,
    currentDocument: filePath
      ? {
          path: filePath,
          name: basename(filePath),
        }
      : null,
  };
}

/**
 * Load the persisted window state from localStorage.
 * Returns the default state if no state is stored or the stored state is
 * malformed.
 */
export function loadWindowState(): WindowState {
  const storageKey = getWindowStateStorageKey();
  const scoped = readLocalStorage<unknown>(storageKey, null);
  const persistedState = migrateWindowState(scoped)
    ?? (
      storageKey !== WINDOW_STATE_KEY
        ? migrateWindowState(readLocalStorage<unknown>(WINDOW_STATE_KEY, null))
        : null
    )
    ?? { ...DEFAULT_STATE };
  const launchState = consumeWindowLaunchStateFromUrl();
  if (!launchState) {
    return persistedState;
  }

  const launchOverridesProjectRoot = Object.hasOwn(launchState, "projectRoot");
  const launchOverridesCurrentDocument = Object.hasOwn(launchState, "currentDocument");
  const nextProjectRoot = launchOverridesProjectRoot
    ? launchState.projectRoot ?? null
    : persistedState.projectRoot;
  const nextCurrentDocument = launchOverridesCurrentDocument
    ? launchState.currentDocument ?? null
    : (
        launchOverridesProjectRoot && nextProjectRoot !== persistedState.projectRoot
          ? null
          : persistedState.currentDocument
      );

  return buildWindowState({
    currentDocument: nextCurrentDocument,
    projectRoot: nextProjectRoot,
    layout: persistedState.layout,
  });
}

export function getWindowStateSnapshot(): WindowState {
  const signature = readWindowStateStorageSignature();
  if (!windowStateSnapshot || signature !== windowStateStorageSignature) {
    windowStateSnapshot = loadWindowState();
    windowStateStorageSignature = readWindowStateStorageSignature();
  }
  return windowStateSnapshot;
}

export function reloadWindowStateSnapshot(): WindowState {
  windowStateSnapshot = loadWindowState();
  windowStateStorageSignature = readWindowStateStorageSignature();
  emitLocalStorageKeyChange(getWindowStateStorageKey());
  return windowStateSnapshot;
}

/**
 * Persist the given window state to localStorage.
 * Silently ignores storage errors (e.g. private-browsing quota limits).
 */
export function saveWindowState(state: WindowState): void {
  writeLocalStorage(getWindowStateStorageKey(), state);
  windowStateSnapshot = state;
  windowStateStorageSignature = readWindowStateStorageSignature();
  emitLocalStorageKeyChange(getWindowStateStorageKey());
}

export function saveWindowStateForLabel(
  windowLabel: string | null,
  state: WindowState,
): void {
  writeLocalStorage(getWindowStateStorageKey(windowLabel), state);
  if (getWindowStateStorageKey(windowLabel) === getWindowStateStorageKey()) {
    windowStateSnapshot = state;
    windowStateStorageSignature = readWindowStateStorageSignature();
  }
  emitLocalStorageKeyChange(getWindowStateStorageKey(windowLabel));
}

export function subscribeWindowState(listener: () => void): () => void {
  const storageKey = getWindowStateStorageKey();
  const handleChange = () => {
    windowStateSnapshot = loadWindowState();
    windowStateStorageSignature = readWindowStateStorageSignature();
    listener();
  };
  const unsubscribeScoped = subscribeLocalStorageKey(storageKey, handleChange);
  const unsubscribeFallback = storageKey === WINDOW_STATE_KEY
    ? () => {}
    : subscribeLocalStorageKey(WINDOW_STATE_KEY, handleChange);
  return () => {
    unsubscribeScoped();
    unsubscribeFallback();
  };
}

/**
 * Build a WindowState snapshot from the current live state.
 * Pass the arrays/values from the app rather than DOM-query them here so this
 * module stays free of DOM dependencies.
 */
export function buildWindowState(opts: {
  currentDocument: CurrentDocumentState | null;
  layout?: WorkspaceLayoutState;
  projectRoot: string | null;
}): WindowState {
  return {
    currentDocument: opts.currentDocument,
    layout: opts.layout ?? DEFAULT_WORKSPACE_LAYOUT_STATE,
    projectRoot: opts.projectRoot,
    version: STATE_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isWindowState(value: unknown): value is WindowState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  if (v["version"] !== STATE_VERSION) return false;
  if (typeof v["projectRoot"] !== "string" && v["projectRoot"] !== null) return false;
  if (!isCurrentDocumentState(v["currentDocument"])) return false;
  if (!normalizeLayoutState(v["layout"])) return false;

  return true;
}

function isCurrentDocumentObject(value: unknown): value is CurrentDocumentState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["path"] === "string" && typeof v["name"] === "string";
}

function isCurrentDocumentState(value: unknown): value is CurrentDocumentState | null {
  if (value === null) return true;
  return isCurrentDocumentObject(value);
}

function isSidebarSectionState(value: unknown): value is SidebarSectionState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["title"] === "string" && typeof v["collapsed"] === "boolean";
}
