import {
  buildWindowState,
  type CurrentDocumentState,
  type WorkspaceLayoutState,
  type WindowState,
} from "./window-state";

export interface TestWindowStateOverrides {
  readonly currentDocument?: CurrentDocumentState | null;
  readonly layout?: Partial<WorkspaceLayoutState>;
  readonly projectRoot?: string | null;
  readonly sidebarWidth?: number;
}

export const DEFAULT_TEST_WINDOW_STATE: WindowState = buildWindowState({
  currentDocument: null,
  projectRoot: null,
});

export function createTestWindowState(
  overrides: TestWindowStateOverrides = {},
): WindowState {
  return buildWindowState({
    currentDocument: overrides.currentDocument ?? null,
    layout: {
      sidebarCollapsed: overrides.layout?.sidebarCollapsed ?? overrides.sidebarWidth === 0,
      sidebarWidth: overrides.layout?.sidebarWidth ?? (overrides.sidebarWidth && overrides.sidebarWidth > 0
        ? overrides.sidebarWidth
        : 220),
      sidebarTab: overrides.layout?.sidebarTab ?? "files",
      sidenotesCollapsed: overrides.layout?.sidenotesCollapsed ?? true,
    },
    projectRoot: overrides.projectRoot ?? null,
  });
}
