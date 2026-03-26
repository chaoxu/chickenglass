import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry, FileSystem } from "../file-manager";

interface MockWindowState {
  projectRoot: string | null;
  currentDocument: { path: string; name: string } | null;
  sidebarWidth: number;
  sidebarSections: unknown[];
  version: number;
}

const workspaceMockState = vi.hoisted(() => ({
  openFolderAt: vi.fn(async (_path: string, _generation: number) => true),
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
  } as MockWindowState,
  reset() {
    this.openFolderAt.mockReset();
    this.openFolderAt.mockImplementation(async (_path: string, _generation: number) => true);
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
    } as MockWindowState;
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

vi.mock("../../lib/tauri", () => ({
  isTauri: () => true,
}));

vi.mock("../tauri-fs", () => ({
  isTauri: () => true,
  pickFolder: vi.fn(async () => null),
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
  fileTree: FileEntry | null;
  projectConfig: Record<string, unknown>;
  startupComplete: boolean;
  openProjectRoot: (path: string) => Promise<FileEntry | null>;
}

function createHarness(fs: FileSystem): { Harness: FC; ref: HarnessRef } {
  const ref: HarnessRef = {
    projectRoot: null,
    fileTree: null,
    projectConfig: {},
    startupComplete: false,
    openProjectRoot: async () => null,
  };

  const Harness: FC = () => {
    const result = useAppWorkspaceSession(fs);
    ref.projectRoot = result.projectRoot;
    ref.fileTree = result.fileTree;
    ref.projectConfig = result.projectConfig;
    ref.startupComplete = result.startupComplete;
    ref.openProjectRoot = result.openProjectRoot;
    return null;
  };

  return { Harness, ref };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function createQueuedFs(listTreeResults: Deferred<FileEntry>[]): FileSystem {
  return {
    listTree: () => {
      const next = listTreeResults.shift();
      if (!next) {
        throw new Error("unexpected listTree call");
      }
      return next.promise;
    },
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
    workspaceMockState.windowState = {
      ...workspaceMockState.windowState,
      projectRoot: null,
    };
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
    expect(workspaceMockState.openFolderAt).toHaveBeenLastCalledWith(
      "/tmp/next-project",
      expect.any(Number),
    );
    expect(workspaceMockState.saveWindowState).toHaveBeenCalledWith({
      projectRoot: "/tmp/next-project",
      currentDocument: null,
    });
  });

  it("keeps tree and config from the newest overlapping project-root load", async () => {
    workspaceMockState.windowState = {
      ...workspaceMockState.windowState,
      projectRoot: null,
    };
    const firstTree = createDeferred<FileEntry>();
    const secondTree = createDeferred<FileEntry>();
    const firstConfig = createDeferred<Record<string, unknown>>();
    const secondConfig = createDeferred<Record<string, unknown>>();
    const fs = createQueuedFs([firstTree, secondTree]);
    workspaceMockState.loadProjectConfig
      .mockImplementationOnce(async () => firstConfig.promise)
      .mockImplementationOnce(async () => secondConfig.promise);
    const { Harness, ref } = createHarness(fs);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    let openFirst!: Promise<FileEntry | null>;
    let openSecond!: Promise<FileEntry | null>;
    await act(async () => {
      openFirst = ref.openProjectRoot("/tmp/project-a");
      await Promise.resolve();
      openSecond = ref.openProjectRoot("/tmp/project-b");
      await Promise.resolve();
    });

    await act(async () => {
      secondTree.resolve({ name: "project-b", path: "", isDirectory: true, children: [] });
      secondConfig.resolve({ bibliography: "b.bib" });
      await openSecond;
    });

    await act(async () => {
      firstTree.resolve({ name: "project-a", path: "", isDirectory: true, children: [] });
      firstConfig.resolve({ bibliography: "a.bib" });
      await openFirst;
    });

    expect(ref.projectRoot).toBe("/tmp/project-b");
    expect(ref.fileTree?.name).toBe("project-b");
    expect(ref.projectConfig).toEqual({ bibliography: "b.bib" });
  });

  it("does not let a stale startup restore overwrite a newer manual open", async () => {
    const restoredOpen = createDeferred<boolean>();
    workspaceMockState.openFolderAt
      .mockImplementationOnce(async () => restoredOpen.promise)
      .mockImplementationOnce(async (_path: string, _generation: number) => true);
    const restoredTree = createDeferred<FileEntry>();
    const manualTree = createDeferred<FileEntry>();
    const restoredConfig = createDeferred<Record<string, unknown>>();
    const manualConfig = createDeferred<Record<string, unknown>>();
    const fs = createQueuedFs([manualTree, restoredTree]);
    workspaceMockState.loadProjectConfig
      .mockImplementationOnce(async () => manualConfig.promise)
      .mockImplementationOnce(async () => restoredConfig.promise);
    const { Harness, ref } = createHarness(fs);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    let manualOpen!: Promise<FileEntry | null>;
    await act(async () => {
      manualOpen = ref.openProjectRoot("/tmp/manual-project");
      await Promise.resolve();
    });

    await act(async () => {
      manualTree.resolve({ name: "manual", path: "", isDirectory: true, children: [] });
      manualConfig.resolve({ bibliography: "manual.bib" });
      await manualOpen;
    });

    await act(async () => {
      restoredOpen.resolve(false);
      restoredTree.resolve({ name: "restored", path: "", isDirectory: true, children: [] });
      restoredConfig.resolve({ bibliography: "restored.bib" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ref.projectRoot).toBe("/tmp/manual-project");
    expect(ref.fileTree?.name).toBe("manual");
    expect(ref.projectConfig).toEqual({ bibliography: "manual.bib" });
    expect(workspaceMockState.saveWindowState).not.toHaveBeenCalledWith({
      projectRoot: null,
      currentDocument: null,
    });
  });
});
