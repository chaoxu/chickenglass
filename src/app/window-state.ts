/**
 * Window state persistence module.
 *
 * Saves and restores:
 * - Open tab paths and their order
 * - Active tab path
 * - Sidebar collapsed state per section
 * - Sidebar width
 *
 * State is persisted to localStorage under the key `cg-window-state`.
 */

import { readLocalStorage, writeLocalStorage } from "./lib/utils";

/** Persisted state for a single editor tab. */
export interface TabState {
  /** Absolute file path. */
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
  /** Ordered list of open tabs. */
  tabs: TabState[];
  /** Path of the active tab, or null if no tab is open. */
  activeTab: string | null;
  /** Sidebar width in pixels. */
  sidebarWidth: number;
  /** Collapsed state per sidebar section, keyed by section title. */
  sidebarSections: SidebarSectionState[];
  /** Schema version for forward compatibility. */
  version: number;
}

const STORAGE_KEY = "cg-window-state";
const STATE_VERSION = 1;

/** Default state used when no persisted state is found. */
const DEFAULT_STATE: WindowState = {
  tabs: [],
  activeTab: null,
  sidebarWidth: 220,
  sidebarSections: [],
  version: STATE_VERSION,
};

/**
 * Load the persisted window state from localStorage.
 * Returns the default state if no state is stored or the stored state is
 * malformed.
 */
export function loadWindowState(): WindowState {
  const parsed = readLocalStorage<unknown>(STORAGE_KEY, null);
  if (!isWindowState(parsed)) return { ...DEFAULT_STATE };
  return parsed;
}

/**
 * Persist the given window state to localStorage.
 * Silently ignores storage errors (e.g. private-browsing quota limits).
 */
export function saveWindowState(state: WindowState): void {
  writeLocalStorage(STORAGE_KEY, state);
}

/** Clear the persisted window state from localStorage. */
export function clearWindowState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable
  }
}

/**
 * Build a WindowState snapshot from the current live state.
 * Pass the arrays/values from the app rather than DOM-query them here so this
 * module stays free of DOM dependencies.
 */
export function buildWindowState(opts: {
  tabs: TabState[];
  activeTab: string | null;
  sidebarWidth: number;
  sidebarSections: SidebarSectionState[];
}): WindowState {
  return {
    tabs: opts.tabs,
    activeTab: opts.activeTab,
    sidebarWidth: opts.sidebarWidth,
    sidebarSections: opts.sidebarSections,
    version: STATE_VERSION,
  };
}

/**
 * Read the current collapsed state of all sidebar sections by querying the
 * sidebar DOM element.
 *
 * Sidebar sections are identified by their `.sidebar-title` text content.
 * Section bodies carry `display: none` when collapsed.
 */
export function readSidebarSections(
  sidebarEl: HTMLElement,
): SidebarSectionState[] {
  const sections: SidebarSectionState[] = [];
  const sectionEls = sidebarEl.querySelectorAll<HTMLElement>(".sidebar-section");
  for (const section of sectionEls) {
    const titleEl = section.querySelector<HTMLElement>(".sidebar-title");
    const bodyEl = section.querySelector<HTMLElement>(".sidebar-section-body");
    if (!titleEl || !bodyEl) continue;
    sections.push({
      title: titleEl.textContent ?? "",
      collapsed: bodyEl.style.display === "none",
    });
  }
  return sections;
}

/**
 * Apply persisted sidebar section states to the sidebar DOM element.
 *
 * Only sections whose title matches an entry in `sections` are affected.
 */
export function applySidebarSections(
  sidebarEl: HTMLElement,
  sections: SidebarSectionState[],
): void {
  const map = new Map(sections.map((s) => [s.title, s.collapsed]));
  const sectionEls = sidebarEl.querySelectorAll<HTMLElement>(".sidebar-section");
  for (const section of sectionEls) {
    const titleEl = section.querySelector<HTMLElement>(".sidebar-title");
    const bodyEl = section.querySelector<HTMLElement>(".sidebar-section-body");
    const toggleEl = section.querySelector<HTMLElement>(".sidebar-toggle");
    if (!titleEl || !bodyEl) continue;

    const title = titleEl.textContent ?? "";
    const collapsed = map.get(title);
    if (collapsed === undefined) continue;

    bodyEl.style.display = collapsed ? "none" : "";
    if (toggleEl) {
      toggleEl.textContent = collapsed ? "▶" : "▼";
    }
  }
}

/**
 * Apply a persisted sidebar width to the sidebar DOM element.
 */
export function applySidebarWidth(
  sidebarEl: HTMLElement,
  width: number,
): void {
  sidebarEl.style.width = `${width}px`;
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isWindowState(value: unknown): value is WindowState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  if (v["version"] !== STATE_VERSION) return false;
  if (typeof v["activeTab"] !== "string" && v["activeTab"] !== null) return false;
  if (typeof v["sidebarWidth"] !== "number") return false;
  if (!Array.isArray(v["tabs"])) return false;
  if (!Array.isArray(v["sidebarSections"])) return false;

  for (const tab of v["tabs"] as unknown[]) {
    if (!isTabState(tab)) return false;
  }
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

function isSidebarSectionState(value: unknown): value is SidebarSectionState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["title"] === "string" && typeof v["collapsed"] === "boolean";
}
