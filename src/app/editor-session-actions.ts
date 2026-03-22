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

export function activateSessionTab(
  state: EditorSessionState,
  path: string | null,
): EditorSessionState {
  if (path === null || findSessionTab(state, path)) {
    return { ...state, activePath: path };
  }
  return state;
}

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

export function reorderSessionTabs(
  state: EditorSessionState,
  tabs: Tab[],
): EditorSessionState {
  const activePath = tabs.some((tab) => tab.path === state.activePath)
    ? state.activePath
    : tabs[0]?.path ?? null;
  return { tabs, activePath };
}

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
