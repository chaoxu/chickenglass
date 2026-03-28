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
  getGitStatus: vi.fn(async (): Promise<Record<string, string>> => ({})),
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
    this.getGitStatus.mockReset();
    this.getGitStatus.mockImplementation(async (): Promise<Record<string, string>> => ({}));
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

vi.mock("../tauri-client/git", () => ({
  gitStatusCommand: () => workspaceMockState.getGitStatus(),
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
  gitStatus: Record<string, string>;
  startupComplete: boolean;
  openProjectRoot: (path: string) => Promise<FileEntry | null>;
  refreshGitStatus: () => Promise<void>;
}

function createHarness(fs: FileSystem): { Harness: FC; ref: HarnessRef } {
  const ref: HarnessRef = {
    projectRoot: null,
    fileTree: null,
    projectConfig: {},
    gitStatus: {},
    startupComplete: false,
    openProjectRoot: async () => null,
    refreshGitStatus: async () => {},
  };

  const Harness: FC = () => {
    const result = useAppWorkspaceSession(fs);
    ref.projectRoot = result.projectRoot;
    ref.fileTree = result.fileTree;
    ref.projectConfig = result.projectConfig;
    ref.gitStatus = result.gitStatus;
    ref.startupComplete = result.startupComplete;
    ref.openProjectRoot = result.openProjectRoot;
    ref.refreshGitStatus = result.refreshGitStatus;
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

    // Separate act() blocks: the dynamic import `await tauriFs()` in
    // production adds microtask ticks, so each load needs its own flush.
    let openFirst!: Promise<FileEntry | null>;
    let openSecond!: Promise<FileEntry | null>;

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

  it("discards stale git status when a newer project open wins the race", async () => {
    // Scenario: save triggers refreshGitStatus() in repo A, user immediately
    // opens non-git folder B. The slow git status from repo A must not
    // overwrite B's empty state.
    const staleGitStatus = createDeferred<Record<string, string>>();
    workspaceMockState.getGitStatus
      .mockImplementationOnce(async () => ({}))          // startup load
      .mockImplementationOnce(async () => staleGitStatus.promise); // refreshGitStatus after "save"
    const { Harness, ref } = createHarness(fsStub);

    // Boot with the saved project root (repo A).
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ref.startupComplete).toBe(true);
    expect(ref.gitStatus).toEqual({});

    // Simulate save → refreshGitStatus(); the result is delayed.
    await act(async () => {
      void ref.refreshGitStatus();
    });

    // Before the stale status resolves, open a different (non-git) folder.
    // This bumps the workspace generation, so the pending result is stale.
    await act(async () => {
      await ref.openProjectRoot("/tmp/non-git-folder");
    });

    expect(ref.projectRoot).toBe("/tmp/non-git-folder");
    expect(ref.gitStatus).toEqual({});

    // Now the stale result from repo A arrives — it must be discarded.
    await act(async () => {
      staleGitStatus.resolve({ "dirty-file.md": "modified" });
      await Promise.resolve();
    });

    expect(ref.gitStatus).toEqual({});
  });

  it("clears git status immediately when opening a new project root", async () => {
    // Scenario: repo A has dirty files. User opens repo B which shares
    // overlapping relative paths (e.g. README.md). The badge map must be
    // cleared before the new tree renders, not after the new git status
    // resolves — otherwise the intermediate render shows A's badges on B's tree.
    workspaceMockState.windowState = {
      ...workspaceMockState.windowState,
      projectRoot: null,
    };
    const treeA = createDeferred<FileEntry>();
    const treeB = createDeferred<FileEntry>();
    const gitStatusA = createDeferred<Record<string, string>>();
    const gitStatusB = createDeferred<Record<string, string>>();
    const fs = createQueuedFs([treeA, treeB]);
    workspaceMockState.getGitStatus
      .mockImplementationOnce(async () => gitStatusA.promise)
      .mockImplementationOnce(async () => gitStatusB.promise);
    const { Harness, ref } = createHarness(fs);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    // Open repo A and let everything resolve, including git status.
    let openA!: Promise<FileEntry | null>;
    await act(async () => {
      openA = ref.openProjectRoot("/tmp/repo-a");
    });
    await act(async () => {
      treeA.resolve({ name: "repo-a", path: "", isDirectory: true, children: [] });
      gitStatusA.resolve({ "README.md": "modified", "src/main.ts": "added" });
      await openA;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ref.projectRoot).toBe("/tmp/repo-a");
    expect(ref.gitStatus).toEqual({ "README.md": "modified", "src/main.ts": "added" });

    // Open repo B — git status is still pending.
    await act(async () => {
      void ref.openProjectRoot("/tmp/repo-b");
      await Promise.resolve();
      await Promise.resolve();
    });

    // Intermediate state: badges must already be cleared even though
    // the new git status hasn't resolved yet.
    expect(ref.gitStatus).toEqual({});

    // New git status arrives for repo B.
    await act(async () => {
      treeB.resolve({ name: "repo-b", path: "", isDirectory: true, children: [] });
      gitStatusB.resolve({ "README.md": "untracked" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ref.gitStatus).toEqual({ "README.md": "untracked" });
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
