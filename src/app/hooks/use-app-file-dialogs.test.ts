import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FileEntry } from "../file-manager";
import { useAppFileDialogs } from "./use-app-file-dialogs";
import type { AppEditorShellController } from "./use-app-editor-shell";
import type { AppPreferencesController } from "./use-app-preferences";
import type { AppWorkspaceSessionController } from "./use-app-workspace-session";

const fileDialogMockState = vi.hoisted(() => ({
  openProjectInCurrentWindow: vi.fn(async () => true),
}));

vi.mock("../project-open", () => ({
  openProjectInCurrentWindow: fileDialogMockState.openProjectInCurrentWindow,
}));

function createDeps() {
  const editor = {
    files: {
      cancelPendingOpenFile: vi.fn(),
      closeCurrentFile: vi.fn(async () => true),
      openFile: vi.fn(async () => {}),
    },
  } as unknown as Pick<AppEditorShellController, "files">;
  const workspace = {
    projectRoot: null,
    openProjectRoot: vi.fn(async (): Promise<FileEntry> => ({
      name: "project",
      path: "",
      isDirectory: true,
      children: [],
    })),
  } satisfies Pick<AppWorkspaceSessionController, "projectRoot" | "openProjectRoot">;
  const preferences = {
    addRecentFolder: vi.fn(),
  } satisfies Pick<AppPreferencesController, "addRecentFolder">;

  return { editor, workspace, preferences };
}

describe("useAppFileDialogs", () => {
  beforeEach(() => {
    fileDialogMockState.openProjectInCurrentWindow.mockReset();
    fileDialogMockState.openProjectInCurrentWindow.mockResolvedValue(true);
  });

  it("records recent folders after the canonical project-open flow succeeds", async () => {
    const deps = createDeps();
    const { result } = renderHook(() => useAppFileDialogs(deps));

    await act(async () => {
      await result.current.openProjectInCurrentWindow("/tmp/project");
    });

    expect(fileDialogMockState.openProjectInCurrentWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: "/tmp/project",
        currentProjectRoot: null,
        openProjectRoot: deps.workspace.openProjectRoot,
      }),
    );
    expect(deps.preferences.addRecentFolder).toHaveBeenCalledWith("/tmp/project");
  });

  it("does not record a recent folder when project open is cancelled or stale", async () => {
    fileDialogMockState.openProjectInCurrentWindow.mockResolvedValue(false);
    const deps = createDeps();
    const { result } = renderHook(() => useAppFileDialogs(deps));

    await act(async () => {
      await result.current.openProjectInCurrentWindow("/tmp/project");
    });

    expect(deps.preferences.addRecentFolder).not.toHaveBeenCalled();
  });
});
