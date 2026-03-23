import type { Tab } from "./tab-bar";
import {
  createEditorSessionState,
  findPreviewTab,
  findSessionTab,
  type EditorSessionState,
} from "./editor-session-model";

function replaceTab(
  tabs: Tab[],
  path: string,
  updater: (tab: Tab) => Tab,
): Tab[] {
  return tabs.map((tab) => (tab.path === path ? updater(tab) : tab));
}

/**
 * Set the active path without opening a new tab.
 *
 * If `path` is null or does not correspond to an existing tab, the call is
 * a no-op — the current active path is retained. This prevents accidentally
 * activating a path that has not been loaded yet.
 */
export function activateSessionTab(
  state: EditorSessionState,
  path: string | null,
): EditorSessionState {
  if (path === null || findSessionTab(state, path)) {
    return { ...state, activePath: path };
  }
  return state;
}

/**
 * Open a tab, handling three distinct cases:
 *
 * 1. **Already open (any mode):** activates it. If the incoming `tab.preview`
 *    is false but the existing tab is a preview, promotes it to permanent.
 * 2. **Not open, incoming is preview:** replaces the current preview tab if one
 *    exists (VS Code-style single-preview slot), otherwise appends.
 * 3. **Not open, permanent:** always appends a new tab.
 *
 * In all cases the newly opened path becomes the active path.
 */
export function openSessionTab(
  state: EditorSessionState,
  tab: Pick<Tab, "path" | "name" | "dirty" | "preview">,
): EditorSessionState {
  const existing = findSessionTab(state, tab.path);
  if (existing) {
    let nextTabs = state.tabs;
    if (!tab.preview && existing.preview) {
      nextTabs = replaceTab(state.tabs, tab.path, (candidate) => ({
        ...candidate,
        preview: false,
      }));
    }
    return { tabs: nextTabs, activePath: tab.path };
  }

  if (tab.preview) {
    const preview = findPreviewTab(state);
    if (preview) {
      return {
        tabs: state.tabs.map((candidate) =>
          candidate.path === preview.path ? { ...tab } : candidate,
        ),
        activePath: tab.path,
      };
    }
  }

  return {
    tabs: [...state.tabs, { ...tab }],
    activePath: tab.path,
  };
}

/**
 * Mark a tab as dirty (unsaved) or clean (saved).
 *
 * Side-effect: if the tab is currently a preview and is being marked dirty,
 * it is automatically promoted to a permanent tab. This prevents a preview
 * slot from being silently replaced while the user has unsaved edits.
 *
 * Returns the existing state object unchanged if the tab is missing or if
 * neither the dirty flag nor the pin promotion would change.
 */
export function markSessionTabDirty(
  state: EditorSessionState,
  path: string,
  dirty: boolean,
): EditorSessionState {
  const current = findSessionTab(state, path);
  if (!current) return state;

  const shouldPin = dirty && current.preview;
  if (current.dirty === dirty && !shouldPin) return state;

  return {
    ...state,
    tabs: replaceTab(state.tabs, path, (tab) => ({
      ...tab,
      dirty,
      ...(shouldPin ? { preview: false } : {}),
    })),
  };
}

/**
 * Promote a preview tab to a permanent tab.
 *
 * A preview tab can be replaced when the user single-clicks a new file.
 * Pinning clears the `preview` flag so the tab is retained. If the tab
 * does not exist or is already permanent, returns `state` unchanged.
 */
export function pinSessionTab(
  state: EditorSessionState,
  path: string,
): EditorSessionState {
  const tab = findSessionTab(state, path);
  if (!tab || !tab.preview) return state;
  return {
    ...state,
    tabs: replaceTab(state.tabs, path, (candidate) => ({
      ...candidate,
      preview: false,
    })),
  };
}

/**
 * Update a tab's path and display name after a file rename.
 *
 * Also updates `activePath` when the renamed file is currently active so
 * the session does not point to a stale path. Returns `state` unchanged
 * if `oldPath` is not found.
 */
export function renameSessionTab(
  state: EditorSessionState,
  oldPath: string,
  newPath: string,
  newName: string,
): EditorSessionState {
  const tab = findSessionTab(state, oldPath);
  if (!tab) return state;

  return {
    tabs: state.tabs.map((candidate) =>
      candidate.path === oldPath
        ? { ...candidate, path: newPath, name: newName }
        : candidate,
    ),
    activePath: state.activePath === oldPath ? newPath : state.activePath,
  };
}

/**
 * Replace the tab list after a drag-and-drop reorder.
 *
 * Preserves `activePath` if it still exists in the reordered list;
 * otherwise falls back to the first tab's path (or null if the list is empty).
 * The caller is responsible for passing a valid permutation of the existing tabs.
 */
export function reorderSessionTabs(
  state: EditorSessionState,
  tabs: Tab[],
): EditorSessionState {
  const activePath = tabs.some((tab) => tab.path === state.activePath)
    ? state.activePath
    : tabs[0]?.path ?? null;
  return { tabs, activePath };
}

/**
 * Close a single tab and determine the next active tab.
 *
 * Selection rules after close:
 * - If the closed tab was not active, `activePath` is unchanged.
 * - If it was active and other tabs exist, activates the tab at
 *   `min(closedIndex, remainingTabs.length - 1)` — i.e., the tab
 *   immediately to the right, or the last tab if closing the rightmost.
 * - If it was the last tab, resets to an empty `createEditorSessionState()`.
 *
 * Returns `state` unchanged if `path` is not found.
 */
export function closeSessionTab(
  state: EditorSessionState,
  path: string,
): EditorSessionState {
  const index = state.tabs.findIndex((tab) => tab.path === path);
  if (index === -1) return state;

  const tabs = state.tabs.filter((tab) => tab.path !== path);
  if (state.activePath !== path) {
    return { tabs, activePath: state.activePath };
  }

  if (tabs.length === 0) {
    return createEditorSessionState();
  }

  const nextIndex = Math.min(index, tabs.length - 1);
  return {
    tabs,
    activePath: tabs[nextIndex].path,
  };
}

/**
 * Close multiple tabs at once (e.g. "close all to the right").
 *
 * If the current `activePath` is among the closed paths, falls back to
 * the first remaining tab (or null). More efficient than calling
 * `closeSessionTab` in a loop because it rebuilds the tab list once.
 * Returns `state` unchanged if `paths` is empty.
 */
export function closeSessionTabs(
  state: EditorSessionState,
  paths: Set<string>,
): EditorSessionState {
  if (paths.size === 0) return state;
  const tabs = state.tabs.filter((tab) => !paths.has(tab.path));
  const activePath = paths.has(state.activePath ?? "")
    ? tabs[0]?.path ?? null
    : state.activePath;
  return { tabs, activePath };
}
