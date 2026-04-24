import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectOpenResult } from "../project-open-result";
import {
  type AppFileDialogsDeps,
  useAppFileDialogs,
} from "./use-app-file-dialogs";

const fileDialogMockState = vi.hoisted(() => ({
  canonicalizeProjectRootCommand: vi.fn(async (path: string): Promise<string> => path),
  pickFolder: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("../../lib/tauri", () => ({
  isTauri: () => true,
}));

vi.mock("../tauri-fs", () => ({
  pickFolder: fileDialogMockState.pickFolder,
}));

vi.mock("../tauri-client/path", () => ({
  canonicalizeProjectRootCommand: fileDialogMockState.canonicalizeProjectRootCommand,
}));

const openedProject: ProjectOpenResult = {
  projectRoot: "/tmp/selected-project",
  tree: {
    name: "project",
    path: "",
    isDirectory: true,
    children: [],
  },
};

function createDeps(
  overrides: {
    openProjectRoot?: AppFileDialogsDeps["workspace"]["openProjectRoot"];
    projectRoot?: string | null;
  } = {},
): AppFileDialogsDeps & {
  addRecentFolder: ReturnType<typeof vi.fn>;
  openProjectRoot: AppFileDialogsDeps["workspace"]["openProjectRoot"];
} {
  const addRecentFolder = vi.fn();
  const openProjectRoot = overrides.openProjectRoot ?? vi.fn(async () => openedProject);

  return {
    addRecentFolder,
    openProjectRoot,
    editor: {
      cancelPendingOpenFile: vi.fn(),
      closeCurrentFile: vi.fn(async () => true),
      openFile: vi.fn(async () => {}),
    },
    workspace: {
      projectRoot: overrides.projectRoot ?? null,
      openProjectRoot,
      addRecentFolder,
    },
  };
}

describe("useAppFileDialogs", () => {
  beforeEach(() => {
    fileDialogMockState.canonicalizeProjectRootCommand.mockReset();
    fileDialogMockState.canonicalizeProjectRootCommand.mockImplementation(
      async (path: string) => path,
    );
    fileDialogMockState.pickFolder.mockReset();
    fileDialogMockState.pickFolder.mockResolvedValue(null);
  });

  it("records a recent folder after the Open Folder request opens a project", async () => {
    fileDialogMockState.pickFolder.mockResolvedValue("/tmp/selected-project");
    const deps = createDeps();
    const { result } = renderHook(() => useAppFileDialogs(deps));

    act(() => {
      result.current.handleOpenFolderRequest();
    });

    await waitFor(() => {
      expect(deps.addRecentFolder).toHaveBeenCalledWith("/tmp/selected-project");
    });
    expect(deps.openProjectRoot).toHaveBeenCalledWith("/tmp/selected-project");
  });

  it("records the canonical root after opening a selected folder alias", async () => {
    fileDialogMockState.pickFolder.mockResolvedValue("/tmp/project-alias");
    fileDialogMockState.canonicalizeProjectRootCommand.mockResolvedValue(
      "/tmp/canonical-project",
    );
    const deps = createDeps({
      openProjectRoot: vi.fn(async () => ({
        ...openedProject,
        projectRoot: "/tmp/canonical-project",
      })),
    });
    const { result } = renderHook(() => useAppFileDialogs(deps));

    act(() => {
      result.current.handleOpenFolderRequest();
    });

    await waitFor(() => {
      expect(deps.addRecentFolder).toHaveBeenCalledWith("/tmp/canonical-project");
    });
    expect(deps.addRecentFolder).not.toHaveBeenCalledWith("/tmp/project-alias");
  });

  it("does not record a recent folder when opening the selected project fails", async () => {
    fileDialogMockState.pickFolder.mockResolvedValue("/tmp/missing-project");
    const deps = createDeps({
      openProjectRoot: vi.fn(async () => null),
    });
    const { result } = renderHook(() => useAppFileDialogs(deps));

    act(() => {
      result.current.handleOpenFolderRequest();
    });

    await waitFor(() => {
      expect(deps.openProjectRoot).toHaveBeenCalledWith("/tmp/missing-project");
    });
    expect(deps.addRecentFolder).not.toHaveBeenCalled();
  });
});
