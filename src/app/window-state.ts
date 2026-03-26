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
import { isTauri } from "../lib/tauri";

/** Persisted state for a single editor tab in the legacy multi-tab model. */
export interface TabState {
  /** Absolute file path. */
  path: string;
  /** Display name cached from last session. */
  name: string;
}

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

/** Full persisted window state. */
export interface WindowState {
  /** Current project root in Tauri mode, or null in browser/demo mode. */
  projectRoot: string | null;
  /** The single document currently open in this window. */
  currentDocument: CurrentDocumentState | null;
  /** Sidebar width in pixels. */
  sidebarWidth: number;
  /** Collapsed state per sidebar section, keyed by section title. */
  sidebarSections: SidebarSectionState[];
  /** Schema version for forward compatibility. */
  version: number;
}

interface LegacyWindowState {
  tabs: TabState[];
  activeTab: string | null;
  sidebarWidth: number;
  sidebarSections: SidebarSectionState[];
  version: 1;
}

const STATE_VERSION = 2;
const LEGACY_STATE_VERSION = 1;
const WINDOW_LAUNCH_PROJECT_ROOT_PARAM = "projectRoot";
const WINDOW_LAUNCH_FILE_PARAM = "file";

/** Default state used when no persisted state is found. */
const DEFAULT_STATE: WindowState = {
  projectRoot: null,
  currentDocument: null,
  sidebarWidth: 220,
  sidebarSections: [],
  version: STATE_VERSION,
};

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
  } catch {
    return null;
  }
}

export function getWindowStateStorageKey(
  windowLabel: string | null = getCurrentWindowLabel(),
): string {
  return windowLabel ? `${WINDOW_STATE_KEY}:${windowLabel}` : WINDOW_STATE_KEY;
}

function parseLegacyWindowState(value: unknown): LegacyWindowState | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;

  if (candidate["version"] !== LEGACY_STATE_VERSION) return null;
  if (typeof candidate["activeTab"] !== "string" && candidate["activeTab"] !== null) return null;
  if (typeof candidate["sidebarWidth"] !== "number") return null;
  if (!Array.isArray(candidate["tabs"])) return null;
  if (!Array.isArray(candidate["sidebarSections"])) return null;

  const tabs = (candidate["tabs"] as unknown[]).filter(isTabState);
  const sections = (candidate["sidebarSections"] as unknown[]).filter(isSidebarSectionState);
  if (tabs.length !== (candidate["tabs"] as unknown[]).length) return null;
  if (sections.length !== (candidate["sidebarSections"] as unknown[]).length) return null;

  return {
    tabs,
    activeTab: candidate["activeTab"] as string | null,
    sidebarWidth: candidate["sidebarWidth"] as number,
    sidebarSections: sections,
    version: LEGACY_STATE_VERSION,
  };
}

function migrateWindowState(value: unknown): WindowState | null {
  if (isWindowState(value)) return value;

  const legacy = parseLegacyWindowState(value);
  if (!legacy) return null;

  const currentDocument = legacy.activeTab
    ? legacy.tabs.find((tab) => tab.path === legacy.activeTab) ?? legacy.tabs[0] ?? null
    : legacy.tabs[0] ?? null;

  return {
    projectRoot: null,
    currentDocument,
    sidebarWidth: legacy.sidebarWidth,
    sidebarSections: legacy.sidebarSections,
    version: STATE_VERSION,
  };
}

function consumeWindowLaunchStateFromUrl(): Partial<WindowState> | null {
  if (typeof window === "undefined") return null;

  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
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
  } catch {
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

  const launchOverridesProjectRoot = Object.prototype.hasOwnProperty.call(launchState, "projectRoot");
  const launchOverridesCurrentDocument = Object.prototype.hasOwnProperty.call(launchState, "currentDocument");
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
    sidebarWidth: persistedState.sidebarWidth,
    sidebarSections: persistedState.sidebarSections,
  });
}

/**
 * Persist the given window state to localStorage.
 * Silently ignores storage errors (e.g. private-browsing quota limits).
 */
export function saveWindowState(state: WindowState): void {
  writeLocalStorage(getWindowStateStorageKey(), state);
}

export function saveWindowStateForLabel(
  windowLabel: string | null,
  state: WindowState,
): void {
  writeLocalStorage(getWindowStateStorageKey(windowLabel), state);
}

/**
 * Build a WindowState snapshot from the current live state.
 * Pass the arrays/values from the app rather than DOM-query them here so this
 * module stays free of DOM dependencies.
 */
export function buildWindowState(opts: {
  currentDocument: CurrentDocumentState | null;
  projectRoot: string | null;
  sidebarWidth: number;
  sidebarSections: SidebarSectionState[];
}): WindowState {
  return {
    currentDocument: opts.currentDocument,
    projectRoot: opts.projectRoot,
    sidebarWidth: opts.sidebarWidth,
    sidebarSections: opts.sidebarSections,
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
  if (typeof v["sidebarWidth"] !== "number") return false;
  if (!Array.isArray(v["sidebarSections"])) return false;
  if (!isCurrentDocumentState(v["currentDocument"])) return false;

  for (const section of v["sidebarSections"] as unknown[]) {
    if (!isSidebarSectionState(section)) return false;
  }

  return true;
}

function isTabState(value: unknown): value is TabState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["path"] === "string" && typeof v["name"] === "string";
}

function isCurrentDocumentState(value: unknown): value is CurrentDocumentState | null {
  if (value === null) return true;
  return isTabState(value);
}

function isSidebarSectionState(value: unknown): value is SidebarSectionState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["title"] === "string" && typeof v["collapsed"] === "boolean";
}
