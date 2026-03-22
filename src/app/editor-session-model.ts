import type { Tab } from "./tab-bar";

export interface EditorSessionState {
  tabs: Tab[];
  activePath: string | null;
}

export function createEditorSessionState(
  tabs: Tab[] = [],
  activePath: string | null = null,
): EditorSessionState {
  return { tabs, activePath };
}

export function findSessionTab(
  state: EditorSessionState,
  path: string,
): Tab | undefined {
  return state.tabs.find((tab) => tab.path === path);
}

export function findPreviewTab(
  state: EditorSessionState,
): Tab | undefined {
  return state.tabs.find((tab) => tab.preview);
}

export function hasSessionPath(
  state: EditorSessionState,
  path: string,
): boolean {
  return state.tabs.some((tab) => tab.path === path);
}
