import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../file-manager";

const workspaceMockState = vi.hoisted(() => ({
  openFolderAt: vi.fn(async (_path: string) => {}),
  saveWindowState: vi.fn(),
  addRecentFolder: vi.fn(),
  addRecentFile: vi.fn(),
  removeRecentFile: vi.fn(),
  loadProjectConfig: vi.fn(async () => ({})),
  windowState: {
    projectRoot: "/tmp/restored-project",
    currentDocument: { path: "draft.md", name: "draft.md" },
    sidebarWidth: 220,
    sidebarSections: [],
    version: 2,
  },
  reset() {
    this.openFolderAt.mockReset();
    this.openFolderAt.mockImplementation(async (_path: string) => {});
    this.saveWindowState.mockReset();
    this.addRecentFolder.mockReset();
    this.addRecentFile.mockReset();
    this.removeRecentFile.mockReset();
    this.loadProjectConfig.mockReset();
    this.loadProjectConfig.mockImplementation(async () => ({}));
    this.windowState = {
      projectRoot: "/tmp/restored-project",
      currentDocument: { path: "draft.md", name: "draft.md" },
      sidebarWidth: 220,
      sidebarSections: [],
      version: 2,
    };
  },
}));

vi.mock("./use-settings", () => ({
  useSettings: () => ({
    settings: {
      autoSaveInterval: 30000,
      fontSize: 16,
      lineHeight: 1.6,
      tabSize: 2,
      showLineNumbers: false,
      wordWrap: true,
      spellCheck: false,
      editorMode: "rich",
      theme: "system",
      defaultExportFormat: "pdf",
      enabledPlugins: {},
      themeName: "default",
      writingTheme: "academic",
      customCss: "",
    },
    updateSetting: vi.fn(),
  }),
}));

vi.mock("./use-theme", () => ({
  useTheme: () => ({
    theme: "system",
    setTheme: vi.fn(),
    resolvedTheme: "light",
  }),
}));

vi.mock("./use-window-state", () => ({
  useWindowState: () => ({
    windowState: workspaceMockState.windowState,
    saveState: workspaceMockState.saveWindowState,
    reloadState: vi.fn(),
  }),
}));

vi.mock("./use-recent-files", () => ({
  useRecentFiles: () => ({
    recentFiles: [],
    recentFolders: [],
    addRecentFile: workspaceMockState.addRecentFile,
    addRecentFolder: workspaceMockState.addRecentFolder,
    removeRecentFile: workspaceMockState.removeRecentFile,
    removeRecent: vi.fn(),
    clearFiles: vi.fn(),
    clearFolders: vi.fn(),
  }),
}));

vi.mock("../tauri-fs", () => ({
  isTauri: () => true,
  openFolder: vi.fn(async () => null),
  openFolderAt: workspaceMockState.openFolderAt,
}));

vi.mock("../project-config", () => ({
  loadProjectConfig: workspaceMockState.loadProjectConfig,
}));

vi.mock("../perf", () => ({
  measureAsync: (_name: string, task: () => Promise<unknown>) => task(),
  withPerfOperation: async (
    _name: string,
    task: (operation: {
      id: string;
      name: string;
      measureAsync: <T>(spanName: string, spanTask: () => Promise<T>) => Promise<T>;
      measureSync: <T>(spanName: string, spanTask: () => T) => T;
      end: () => void;
    }) => Promise<unknown>,
  ) => task({
    id: "test-operation",
    name: "test-operation",
    measureAsync: async (_spanName, spanTask) => spanTask(),
    measureSync: (_spanName, spanTask) => spanTask(),
    end: () => {},
  }),
}));

const { useAppWorkspaceSession } = await import("./use-app-workspace-session");

interface HarnessRef {
  projectRoot: string | null;
  startupComplete: boolean;
  openProjectRoot: (path: string) => Promise<void>;
}

function createHarness(fs: FileSystem): { Harness: FC; ref: HarnessRef } {
  const ref: HarnessRef = {
    projectRoot: null,
    startupComplete: false,
    openProjectRoot: async () => {},
  };

  const Harness: FC = () => {
    const result = useAppWorkspaceSession(fs);
    ref.projectRoot = result.projectRoot;
    ref.startupComplete = result.startupComplete;
    ref.openProjectRoot = result.openProjectRoot;
    return null;
  };

  return { Harness, ref };
}

const fsStub: FileSystem = {
  listTree: async () => ({ name: "root", path: "", isDirectory: true, children: [] }),
  readFile: async () => "",
  writeFile: async () => {},
  createFile: async () => {},
  exists: async () => false,
  renameFile: async () => {},
  createDirectory: async () => {},
  deleteFile: async () => {},
  writeFileBinary: async () => {},
  readFileBinary: async () => new Uint8Array(),
};

describe("useAppWorkspaceSession", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    workspaceMockState.reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("clears invalid restored project state when reopening the saved root fails", async () => {
    workspaceMockState.openFolderAt.mockRejectedValueOnce(new Error("missing folder"));
    const { Harness, ref } = createHarness(fsStub);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ref.startupComplete).toBe(true);
    expect(ref.projectRoot).toBeNull();
    expect(workspaceMockState.saveWindowState).toHaveBeenCalledWith({
      projectRoot: null,
      currentDocument: null,
    });
  });

  it("clears the persisted document when switching to a different project root", async () => {
    const { Harness, ref } = createHarness(fsStub);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    workspaceMockState.saveWindowState.mockClear();

    await act(async () => {
      await ref.openProjectRoot("/tmp/next-project");
    });

    expect(ref.projectRoot).toBe("/tmp/next-project");
    expect(workspaceMockState.openFolderAt).toHaveBeenLastCalledWith("/tmp/next-project");
    expect(workspaceMockState.saveWindowState).toHaveBeenCalledWith({
      projectRoot: "/tmp/next-project",
      currentDocument: null,
    });
  });
});
