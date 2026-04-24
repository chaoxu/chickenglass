import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry, FileSystem } from "../file-manager";
import type { ProjectOpenResult } from "../project-open-result";

interface MockWindowState {
  projectRoot: string | null;
  currentDocument: { path: string; name: string } | null;
  layout: {
    sidebarCollapsed: boolean;
    sidebarTab: "files" | "outline" | "diagnostics" | "runtime";
    sidebarWidth: number;
    sidenotesCollapsed: boolean;
  };
  version: number;
}

const workspaceMockState = vi.hoisted(() => {
  const defaultLayout = {
    sidebarCollapsed: false,
    sidebarTab: "files" as const,
    sidebarWidth: 220,
    sidenotesCollapsed: true,
  };

  return {
  openFolderAt: vi.fn(async (path: string, _generation: number) => ({
    applied: true,
    root: path,
  })),
  saveWindowState: vi.fn(),
  addRecentFolder: vi.fn(),
  addRecentFile: vi.fn(),
  removeRecentFile: vi.fn(),
  pickFolder: vi.fn(async () => null as string | null),
  loadProjectConfig: vi.fn(async () => ({})),
  windowState: {
    projectRoot: "/tmp/restored-project",
    currentDocument: { path: "draft.md", name: "draft.md" },
    layout: defaultLayout,
    version: 3,
  } as MockWindowState,
  reset() {
    this.openFolderAt.mockReset();
    this.openFolderAt.mockImplementation(async (path: string, _generation: number) => ({
      applied: true,
      root: path,
    }));
    this.saveWindowState.mockReset();
    this.saveWindowState.mockImplementation((patch: Partial<MockWindowState>) => {
      this.windowState = {
        ...this.windowState,
        ...patch,
      } as MockWindowState;
    });
    this.addRecentFolder.mockReset();
    this.addRecentFile.mockReset();
    this.removeRecentFile.mockReset();
    this.pickFolder.mockReset();
    this.pickFolder.mockImplementation(async () => null);
    this.loadProjectConfig.mockReset();
    this.loadProjectConfig.mockImplementation(async () => ({}));
    this.windowState = {
      projectRoot: "/tmp/restored-project",
      currentDocument: { path: "draft.md", name: "draft.md" },
      layout: defaultLayout,
      version: 3,
    } as MockWindowState;
  },
  };
});

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
      editorMode: "cm6-rich",
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
  pickFolder: workspaceMockState.pickFolder,
  openFolderAt: workspaceMockState.openFolderAt,
}));

vi.mock("../project-config", () => ({
  PROJECT_CONFIG_FILE: "coflat.yaml",
  loadProjectConfigWithStatus: async (_fs: FileSystem) => ({
    config: await workspaceMockState.loadProjectConfig(),
    status: { state: "ok", path: "coflat.yaml" },
  }),
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
  openProjectRoot: (path: string) => Promise<ProjectOpenResult | null>;
  handleOpenFolder: () => void;
  refreshTree: (changedPath?: string) => Promise<void>;
}

function createHarness(fs: FileSystem): { Harness: FC; ref: HarnessRef } {
  const ref: HarnessRef = {
    projectRoot: null,
    fileTree: null,
    projectConfig: {},
    startupComplete: false,
    openProjectRoot: async () => null,
    handleOpenFolder: () => {},
    refreshTree: async () => {},
  };

  const Harness: FC = () => {
    const result = useAppWorkspaceSession(fs);
    ref.projectRoot = result.projectRoot;
    ref.fileTree = result.fileTree;
    ref.projectConfig = result.projectConfig;
    ref.startupComplete = result.startupComplete;
    ref.openProjectRoot = result.openProjectRoot;
    ref.handleOpenFolder = result.handleOpenFolder;
    ref.refreshTree = result.refreshTree;
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

class MethodBackedFileSystem implements FileSystem {
  readonly childrenCalls: string[] = [];

  async listTree(): Promise<FileEntry> {
    return { name: "project", path: "", isDirectory: true, children: [] };
  }

  async listChildren(path: string): Promise<FileEntry[]> {
    this.childrenCalls.push(path);
    return [{ name: "notes.md", path: "notes.md", isDirectory: false }];
  }

  async readFile(): Promise<string> {
    return "";
  }

  async writeFile(): Promise<void> {}

  async createFile(): Promise<void> {}

  async exists(): Promise<boolean> {
    return false;
  }

  async renameFile(): Promise<void> {}

  async createDirectory(): Promise<void> {}

  async deleteFile(): Promise<void> {}

  async writeFileBinary(): Promise<void> {}

  async readFileBinary(): Promise<Uint8Array> {
    return new Uint8Array();
  }
}

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

  it("persists and exposes the backend canonical root after opening an alias", async () => {
    workspaceMockState.windowState = {
      ...workspaceMockState.windowState,
      projectRoot: null,
    };
    workspaceMockState.openFolderAt.mockResolvedValueOnce({
      applied: true,
      root: "/tmp/canonical-project",
    });
    const { Harness, ref } = createHarness(fsStub);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    let result: ProjectOpenResult | null | undefined;
    await act(async () => {
      result = await ref.openProjectRoot("/tmp/project-alias");
    });

    expect(result?.projectRoot).toBe("/tmp/canonical-project");
    expect(ref.projectRoot).toBe("/tmp/canonical-project");
    expect(workspaceMockState.saveWindowState).toHaveBeenCalledWith({
      projectRoot: "/tmp/canonical-project",
      currentDocument: null,
    });
  });

  it("persists the backend canonical root after startup restores an alias", async () => {
    workspaceMockState.windowState = {
      ...workspaceMockState.windowState,
      projectRoot: "/tmp/project-alias",
      currentDocument: { path: "draft.md", name: "draft.md" },
    };
    workspaceMockState.openFolderAt.mockResolvedValueOnce({
      applied: true,
      root: "/tmp/canonical-project",
    });
    const { Harness, ref } = createHarness(fsStub);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(ref.projectRoot).toBe("/tmp/canonical-project");
    });
    expect(workspaceMockState.saveWindowState).toHaveBeenCalledWith({
      projectRoot: "/tmp/canonical-project",
    });

    workspaceMockState.windowState = {
      ...workspaceMockState.windowState,
      projectRoot: "/tmp/canonical-project",
    };
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(workspaceMockState.openFolderAt).toHaveBeenCalledTimes(1);
    expect(ref.startupComplete).toBe(true);
  });

  it("records the backend canonical root in recent folders after picker open", async () => {
    workspaceMockState.windowState = {
      ...workspaceMockState.windowState,
      projectRoot: null,
    };
    workspaceMockState.pickFolder.mockResolvedValueOnce("/tmp/project-alias");
    workspaceMockState.openFolderAt.mockResolvedValueOnce({
      applied: true,
      root: "/tmp/canonical-project",
    });
    const { Harness, ref } = createHarness(fsStub);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      ref.handleOpenFolder();
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(workspaceMockState.addRecentFolder).toHaveBeenCalledWith("/tmp/canonical-project");
    });
  });

  it("preserves filesystem method receivers when shallow-loading children", async () => {
    workspaceMockState.windowState = {
      ...workspaceMockState.windowState,
      projectRoot: null,
    };
    const fs = new MethodBackedFileSystem();
    const { Harness, ref } = createHarness(fs);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await ref.openProjectRoot("/tmp/method-backed-project");
    });

    expect(fs.childrenCalls).toEqual([""]);
    expect(ref.fileTree?.children?.map((entry) => entry.path)).toEqual(["notes.md"]);
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

    // Separate act() blocks: the dynamic import `await tauriFs()` in
    // production adds microtask ticks, so each load needs its own flush.
    let openFirst!: Promise<ProjectOpenResult | null>;
    let openSecond!: Promise<ProjectOpenResult | null>;

    await act(async () => {
      openFirst = ref.openProjectRoot("/tmp/project-a");
    });
    await act(async () => {
      openSecond = ref.openProjectRoot("/tmp/project-b");
    });

    // Resolve newer load first, then stale — stale should be discarded
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
    const restoredOpen = createDeferred<{ applied: boolean; root: string }>();
    workspaceMockState.openFolderAt
      .mockImplementationOnce(async () => restoredOpen.promise)
      .mockImplementationOnce(async (path: string, _generation: number) => ({
        applied: true,
        root: path,
      }));
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

    let manualOpen!: Promise<ProjectOpenResult | null>;
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
      restoredOpen.resolve({ applied: false, root: "/tmp/restored-project" });
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

describe("refreshTree scoped refresh", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    workspaceMockState.reset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  interface TrackedFs extends FileSystem {
    tracker: { listChildrenCalls: string[]; listTreeCalls: number };
  }

  function createScopedFs(): TrackedFs {
    const tracker = { listChildrenCalls: [] as string[], listTreeCalls: 0 };
    const fullTree: FileEntry = {
      name: "project", path: "", isDirectory: true,
      children: [
        {
          name: "docs", path: "docs", isDirectory: true,
          children: [
            { name: "a.md", path: "docs/a.md", isDirectory: false },
          ],
        },
        { name: "main.md", path: "main.md", isDirectory: false },
      ],
    };
    return {
      tracker,
      listTree: async () => { tracker.listTreeCalls++; return fullTree; },
      listChildren: async (path: string) => {
        tracker.listChildrenCalls.push(path);
        if (path === "") return fullTree.children ?? [];
        if (path === "docs") return [
          { name: "a.md", path: "docs/a.md", isDirectory: false },
          { name: "b.md", path: "docs/b.md", isDirectory: false },
        ];
        return [];
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

  it("uses listChildren instead of listTree when changedPath is provided", async () => {
    const fs = createScopedFs();
    const { Harness, ref } = createHarness(fs);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ref.startupComplete).toBe(true);
    // Reset counters after startup
    fs.tracker.listTreeCalls = 0;
    fs.tracker.listChildrenCalls = [];

    await act(async () => {
      await ref.refreshTree("docs/b.md");
    });

    expect(fs.tracker.listChildrenCalls).toEqual(["docs"]);
    expect(fs.tracker.listTreeCalls).toBe(0);
  });

  it("falls back to full listTree when no changedPath is provided", async () => {
    const fs = createScopedFs();
    const { Harness, ref } = createHarness(fs);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    fs.tracker.listTreeCalls = 0;
    fs.tracker.listChildrenCalls = [];

    await act(async () => {
      await ref.refreshTree();
    });

    expect(fs.tracker.listTreeCalls).toBe(1);
    expect(fs.tracker.listChildrenCalls).toEqual([]);
  });

  it("updates the file tree with new children from scoped refresh", async () => {
    const fs = createScopedFs();
    const { Harness, ref } = createHarness(fs);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await ref.refreshTree("docs/b.md");
    });

    const docsNode = ref.fileTree?.children?.find((c) => c.name === "docs");
    expect(docsNode?.children?.map((c) => c.name)).toEqual(["a.md", "b.md"]);
  });

  it("does not let an older scoped refresh overwrite newer children for the same directory", async () => {
    const firstDocs = createDeferred<FileEntry[]>();
    const secondDocs = createDeferred<FileEntry[]>();
    const rootChildren: FileEntry[] = [
      {
        name: "docs",
        path: "docs",
        isDirectory: true,
        children: [{ name: "a.md", path: "docs/a.md", isDirectory: false }],
      },
    ];
    let docsCallCount = 0;
    const fs: FileSystem = {
      listTree: async () => ({ name: "project", path: "", isDirectory: true, children: rootChildren }),
      listChildren: async (path: string) => {
        if (path === "") return rootChildren;
        if (path !== "docs") return [];
        docsCallCount += 1;
        return docsCallCount === 1 ? firstDocs.promise : secondDocs.promise;
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
    const { Harness, ref } = createHarness(fs);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    let firstRefresh!: Promise<void>;
    let secondRefresh!: Promise<void>;
    await act(async () => {
      firstRefresh = ref.refreshTree("docs/a.md");
      await Promise.resolve();
      secondRefresh = ref.refreshTree("docs/b.md");
      await Promise.resolve();
    });

    await act(async () => {
      secondDocs.resolve([
        { name: "a.md", path: "docs/a.md", isDirectory: false },
        { name: "b.md", path: "docs/b.md", isDirectory: false },
      ]);
      await secondRefresh;
    });

    await act(async () => {
      firstDocs.resolve([
        { name: "a.md", path: "docs/a.md", isDirectory: false },
        { name: "stale.md", path: "docs/stale.md", isDirectory: false },
      ]);
      await firstRefresh;
    });

    const docsNode = ref.fileTree?.children?.find((c) => c.name === "docs");
    expect(docsNode?.children?.map((c) => c.name)).toEqual(["a.md", "b.md"]);
  });

  it("refreshes root when changed path has no parent directory", async () => {
    const fs = createScopedFs();
    const { Harness, ref } = createHarness(fs);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    fs.tracker.listChildrenCalls = [];

    await act(async () => {
      await ref.refreshTree("new-file.md");
    });

    expect(fs.tracker.listChildrenCalls).toEqual([""]);
  });

  it("reloads project config when coflat.yaml changes during a scoped refresh", async () => {
    workspaceMockState.loadProjectConfig
      .mockResolvedValueOnce({ bibliography: "old.bib" })
      .mockResolvedValueOnce({ bibliography: "new.bib" });
    const fs = createScopedFs();
    const { Harness, ref } = createHarness(fs);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ref.projectConfig).toEqual({ bibliography: "old.bib" });

    await act(async () => {
      await ref.refreshTree("coflat.yaml");
    });

    expect(fs.tracker.listChildrenCalls.at(-1)).toBe("");
    expect(ref.projectConfig).toEqual({ bibliography: "new.bib" });
  });

  it("falls back to listTree when fs has no listChildren", async () => {
    const listTreeSpy = vi.fn(async (): Promise<FileEntry> => ({
      name: "project", path: "", isDirectory: true, children: [],
    }));
    const noListChildrenFs: FileSystem = {
      listTree: listTreeSpy,
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
    const { Harness, ref } = createHarness(noListChildrenFs);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    listTreeSpy.mockClear();

    await act(async () => {
      await ref.refreshTree("some/file.md");
    });

    expect(listTreeSpy).toHaveBeenCalledOnce();
  });
});
