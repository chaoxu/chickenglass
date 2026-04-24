import {
  buildWindowState,
  type CurrentDocumentState,
  type SidebarSectionState,
  type WindowState,
} from "./window-state";

export interface TestWindowStateOverrides {
  readonly currentDocument?: CurrentDocumentState | null;
  readonly projectRoot?: string | null;
  readonly sidebarSections?: SidebarSectionState[];
  readonly sidebarWidth?: number;
}

export const DEFAULT_TEST_WINDOW_STATE: WindowState = buildWindowState({
  currentDocument: null,
  projectRoot: null,
  sidebarSections: [],
  sidebarWidth: 220,
});

export function createTestWindowState(
  overrides: TestWindowStateOverrides = {},
): WindowState {
  return buildWindowState({
    currentDocument: overrides.currentDocument ?? null,
    projectRoot: overrides.projectRoot ?? null,
    sidebarSections: overrides.sidebarSections ?? [],
    sidebarWidth: overrides.sidebarWidth ?? 220,
  });
}
