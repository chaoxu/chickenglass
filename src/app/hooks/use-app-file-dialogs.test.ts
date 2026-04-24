import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectOpenResult } from "../project-open-result";
import {
  type AppFileDialogsDeps,
  useAppFileDialogs,
} from "./use-app-file-dialogs";

const fileDialogMockState = vi.hoisted(() => ({
  canonicalizeProjectRootCommand: vi.fn(async (path: string): Promise<string> => path),
  openDialog: vi.fn(async (): Promise<string | string[] | null> => null),
  openDocumentInNewWindow: vi.fn(async (): Promise<void> => {}),
  pickFolder: vi.fn(async (): Promise<string | null> => null),
  resolveProjectFileTargetCommand: vi.fn(async (path: string) => ({
    projectRoot: path,
    relativePath: path,
  })),
  toProjectRelativePathCommand: vi.fn(async (path: string): Promise<string> => path),
}));

vi.mock("../../lib/tauri", () => ({
  isTauri: () => true,
}));

vi.mock("../tauri-fs", () => ({
  pickFolder: fileDialogMockState.pickFolder,
}));

vi.mock("../tauri-client/path", () => ({
  canonicalizeProjectRootCommand: fileDialogMockState.canonicalizeProjectRootCommand,
  resolveProjectFileTargetCommand: fileDialogMockState.resolveProjectFileTargetCommand,
}));

vi.mock("../tauri-client/fs", () => ({
  toProjectRelativePathCommand: fileDialogMockState.toProjectRelativePathCommand,
}));

vi.mock("../window-launch", () => ({
  openDocumentInNewWindow: fileDialogMockState.openDocumentInNewWindow,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: fileDialogMockState.openDialog,
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
    probeProjectRoot?: AppFileDialogsDeps["workspace"]["probeProjectRoot"];
    projectRoot?: string | null;
  } = {},
): AppFileDialogsDeps & {
  addRecentFolder: ReturnType<typeof vi.fn>;
  openProjectRoot: AppFileDialogsDeps["workspace"]["openProjectRoot"];
  probeProjectRoot: AppFileDialogsDeps["workspace"]["probeProjectRoot"];
} {
  const addRecentFolder = vi.fn();
  const openProjectRoot = overrides.openProjectRoot ?? vi.fn(async () => openedProject);
  const probeProjectRoot = overrides.probeProjectRoot ?? vi.fn(async (path: string) => ({
    projectRoot: path,
    tree: openedProject.tree,
  }));

  return {
    addRecentFolder,
    openProjectRoot,
    probeProjectRoot,
    editor: {
      cancelPendingOpenFile: vi.fn(),
      closeCurrentFile: vi.fn(async () => true),
      openFile: vi.fn(async () => {}),
      restoreDocumentFromRecovery: vi.fn(async () => {}),
    },
    workspace: {
      projectRoot: overrides.projectRoot ?? null,
      probeProjectRoot,
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
    fileDialogMockState.openDialog.mockReset();
    fileDialogMockState.openDialog.mockResolvedValue(null);
    fileDialogMockState.openDocumentInNewWindow.mockReset();
    fileDialogMockState.pickFolder.mockReset();
    fileDialogMockState.pickFolder.mockResolvedValue(null);
    fileDialogMockState.resolveProjectFileTargetCommand.mockReset();
    fileDialogMockState.resolveProjectFileTargetCommand.mockImplementation(async (path: string) => ({
      projectRoot: path,
      relativePath: path,
    }));
    fileDialogMockState.toProjectRelativePathCommand.mockReset();
    fileDialogMockState.toProjectRelativePathCommand.mockImplementation(
      async (path: string) => path,
    );
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
    expect(deps.openProjectRoot).toHaveBeenCalledWith(
      "/tmp/selected-project",
      { projectRoot: "/tmp/selected-project", tree: openedProject.tree },
    );
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
      expect(deps.openProjectRoot).toHaveBeenCalledWith(
        "/tmp/missing-project",
        { projectRoot: "/tmp/missing-project", tree: openedProject.tree },
      );
    });
    expect(deps.addRecentFolder).not.toHaveBeenCalled();
  });

  it("opens a nested external Markdown file from its project config root", async () => {
    fileDialogMockState.openDialog.mockResolvedValue("/tmp/project/chapters/intro.md");
    fileDialogMockState.resolveProjectFileTargetCommand.mockResolvedValue({
      projectRoot: "/tmp/project",
      relativePath: "chapters/intro.md",
    });
    const deps = createDeps({
      openProjectRoot: vi.fn(async () => ({
        projectRoot: "/tmp/project",
        tree: openedProject.tree,
      })),
    });
    const { result } = renderHook(() => useAppFileDialogs(deps));

    act(() => {
      result.current.handleOpenFileRequest();
    });

    await waitFor(() => {
      expect(deps.openProjectRoot).toHaveBeenCalledWith(
        "/tmp/project",
        { projectRoot: "/tmp/project", tree: openedProject.tree },
      );
    });
    expect(deps.editor.openFile).toHaveBeenCalledWith("chapters/intro.md");
  });

  it("opens an external Markdown file in a new window from its project config root", async () => {
    fileDialogMockState.openDialog.mockResolvedValue("/tmp/project/chapters/intro.md");
    fileDialogMockState.resolveProjectFileTargetCommand.mockResolvedValue({
      projectRoot: "/tmp/project",
      relativePath: "chapters/intro.md",
    });
    fileDialogMockState.toProjectRelativePathCommand.mockRejectedValue(
      new Error("Path escapes project root"),
    );
    const deps = createDeps({ projectRoot: "/tmp/current" });
    const { result } = renderHook(() => useAppFileDialogs(deps));

    act(() => {
      result.current.handleOpenFileRequest();
    });

    await waitFor(() => {
      expect(fileDialogMockState.openDocumentInNewWindow).toHaveBeenCalledWith(
        "/tmp/project",
        "chapters/intro.md",
      );
    });
    expect(deps.editor.openFile).not.toHaveBeenCalled();
  });
});
