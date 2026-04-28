import { act, createElement, type FC, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../file-manager";
import type { HotExitBackupStore } from "../hot-exit-backups";
import type { WindowState } from "../window-state";
import {
  createTestWindowState,
  type TestWindowStateOverrides,
} from "../window-state-test-fixtures";
import { useAppSessionPersistence } from "./use-app-session-persistence";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function createMockWindowState(overrides?: TestWindowStateOverrides): WindowState {
  return createTestWindowState(overrides);
}

function createFileTree(path: string, children?: FileEntry[]): FileEntry {
  return {
    name: "project",
    path: "",
    isDirectory: true,
    children: children ?? [{ name: path, path, isDirectory: false }],
  };
}

function createRecoveryStore(overrides?: Partial<HotExitBackupStore>): HotExitBackupStore {
  return {
    writeBackup: vi.fn(async () => ({
      bytes: 100,
      contentHash: "hash",
      id: "id",
      name: "draft.md",
      path: "draft.md",
      projectKey: "project",
      projectRoot: "/project",
      updatedAt: 100,
    })),
    listBackups: vi.fn(async () => []),
    readBackup: vi.fn(async () => null),
    deleteBackup: vi.fn(async () => {}),
    ...overrides,
  };
}

interface TestRef {
  openFileCalls: string[];
  restoreDocumentFromRecoveryCalls: Array<{
    baselineHash?: string;
    content: string;
    path: string;
  }>;
  setSidebarCollapsedCalls: boolean[];
  setSidebarTabCalls: string[];
  setSidebarWidthCalls: number[];
  setSidenotesCollapsedCalls: boolean[];
}

function createHarness(deps: {
  fileTree: FileEntry | null;
  listChildren?: (path: string) => Promise<FileEntry[]>;
  workspaceRequestRef: { current: number };
  windowState: WindowState;
  saveWindowState?: (patch: Partial<WindowState>) => void;
  startupComplete?: boolean;
  sidebarCollapsed?: boolean;
  sidebarWidth?: number;
  openFileShouldReject?: boolean;
  hotExitBackupStore?: HotExitBackupStore | null;
}): { Harness: FC; ref: TestRef } {
  const ref: TestRef = {
    openFileCalls: [],
    restoreDocumentFromRecoveryCalls: [],
    setSidebarCollapsedCalls: [],
    setSidebarTabCalls: [],
    setSidebarWidthCalls: [],
    setSidenotesCollapsedCalls: [],
  };

  const setSidebarCollapsed: Dispatch<SetStateAction<boolean>> = (value) => {
    const result = typeof value === 'function' ? value(false) : value;
    ref.setSidebarCollapsedCalls.push(result);
  };

  const setSidebarWidth: Dispatch<SetStateAction<number>> = (value) => {
    const result = typeof value === 'function' ? value(224) : value;
    ref.setSidebarWidthCalls.push(result);
  };

  const setSidebarTab: Dispatch<SetStateAction<"files" | "outline" | "diagnostics" | "runtime">> = (value) => {
    const result = typeof value === 'function' ? value("files") : value;
    ref.setSidebarTabCalls.push(result);
  };

  const setSidenotesCollapsed: Dispatch<SetStateAction<boolean>> = (value) => {
    const result = typeof value === 'function' ? value(true) : value;
    ref.setSidenotesCollapsedCalls.push(result);
  };

  const Harness: FC = () => {
    useAppSessionPersistence({
      fileTree: deps.fileTree,
      listChildren: deps.listChildren,
      workspaceRequestRef: deps.workspaceRequestRef,
      workspace: {
        projectRoot: deps.windowState.projectRoot,
        windowState: deps.windowState,
        saveWindowState: deps.saveWindowState ?? vi.fn(),
        startupComplete: deps.startupComplete ?? true,
      },
      sidebarLayout: {
        sidebarCollapsed: deps.sidebarCollapsed ?? false,
        sidebarTab: deps.windowState.layout.sidebarTab,
        sidebarWidth: deps.sidebarWidth ?? 224,
        sidenotesCollapsed: deps.windowState.layout.sidenotesCollapsed,
        setSidebarCollapsed,
        setSidebarTab,
        setSidebarWidth,
        setSidenotesCollapsed,
      },
      editor: {
        currentDocument: null,
        currentPath: null,
        openFile: async (path: string) => {
          ref.openFileCalls.push(path);
          if (deps.openFileShouldReject) {
            throw new Error("openFile failed");
          }
        },
        restoreDocumentFromRecovery: async (
          path: string,
          content: string,
          options?: { baselineHash?: string },
        ) => {
          ref.restoreDocumentFromRecoveryCalls.push({
            baselineHash: options?.baselineHash,
            content,
            path,
          });
        },
      },
      hotExitBackupStore: deps.hotExitBackupStore,
    });
    return null;
  };

  return { Harness, ref };
}

describe("useAppSessionPersistence", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    window.history.replaceState({}, "", "/");
    vi.useRealTimers();
  });

  it("restores the previously saved document path on startup", async () => {
    const windowState = createMockWindowState({
      currentDocument: { path: "draft.md", name: "draft.md" },
      sidebarWidth: 220,
    });
    const { Harness, ref } = createHarness({
      fileTree: createFileTree("draft.md"),
      workspaceRequestRef: { current: 0 },
      windowState,
    });

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    expect(ref.openFileCalls).toContain("draft.md");
  });

  it("restores sidebar width from saved state", async () => {
    const windowState = createMockWindowState({
      currentDocument: null,
      sidebarWidth: 300,
    });
    const { Harness, ref } = createHarness({
      fileTree: createFileTree("main.md"),
      workspaceRequestRef: { current: 0 },
      windowState,
    });

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    expect(ref.setSidebarWidthCalls).toContain(300);
  });

  it("restores collapsed sidebar when width is 0", async () => {
    const windowState = createMockWindowState({
      currentDocument: null,
      sidebarWidth: 0,
    });
    const { Harness, ref } = createHarness({
      fileTree: createFileTree("main.md"),
      workspaceRequestRef: { current: 0 },
      windowState,
    });

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    expect(ref.setSidebarCollapsedCalls).toContain(true);
  });

  it("restores the canonical persisted layout state", async () => {
    const windowState = createMockWindowState({
      currentDocument: null,
      layout: {
        sidebarCollapsed: false,
        sidebarTab: "diagnostics",
        sidebarWidth: 360,
        sidenotesCollapsed: false,
      },
    });
    const { Harness, ref } = createHarness({
      fileTree: createFileTree("main.md"),
      workspaceRequestRef: { current: 0 },
      windowState,
    });

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    expect(ref.setSidebarCollapsedCalls).toContain(false);
    expect(ref.setSidebarTabCalls).toContain("diagnostics");
    expect(ref.setSidebarWidthCalls).toContain(360);
    expect(ref.setSidenotesCollapsedCalls).toContain(false);
  });

  it("debounces sidebar width persistence", async () => {
    vi.useFakeTimers();
    const saveWindowState = vi.fn();
    const deps = {
      fileTree: createFileTree("main.md"),
      workspaceRequestRef: { current: 0 },
      windowState: createMockWindowState({
        currentDocument: null,
        sidebarWidth: 220,
      }),
      saveWindowState,
      sidebarWidth: 224,
    };
    const { Harness } = createHarness(deps);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    saveWindowState.mockClear();
    vi.clearAllTimers();

    deps.sidebarWidth = 260;
    act(() => {
      root.render(createElement(Harness));
    });
    deps.sidebarWidth = 280;
    act(() => {
      root.render(createElement(Harness));
    });

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(saveWindowState).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(saveWindowState).toHaveBeenCalledTimes(1);
    expect(saveWindowState).toHaveBeenCalledWith({
      layout: {
        sidebarCollapsed: false,
        sidebarTab: "files",
        sidebarWidth: 280,
        sidenotesCollapsed: true,
      },
    });

    vi.useRealTimers();
  });

  it("discards stale restore result when project switches during lazy search", async () => {
    // Scenario: lazy search is in flight for project A, but workspace generation
    // increments (project switch), so findDefaultDocumentPath result should be discarded.
    const listChildrenDeferred = createDeferred<FileEntry[]>();
    const listChildren = vi.fn(async () => listChildrenDeferred.promise);
    const workspaceRequestRef = { current: 1 };
    const windowState = createMockWindowState({
      currentDocument: null,
      sidebarWidth: 220,
    });
    const { Harness, ref } = createHarness({
      fileTree: createFileTree("", [
        {
          name: "subdir",
          path: "subdir",
          isDirectory: true,
          children: undefined, // unloaded — will trigger listChildren
        },
      ]),
      listChildren,
      workspaceRequestRef,
      windowState,
    });

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    expect(listChildren).toHaveBeenCalledWith("subdir");

    // Project switches (generation increments)
    workspaceRequestRef.current = 2;

    // Now the lazy search resolves
    await act(async () => {
      listChildrenDeferred.resolve([
        { name: "found.md", path: "subdir/found.md", isDirectory: false },
      ]);
      await Promise.resolve();
    });

    // The stale result should be discarded — openFile should not be called
    // for the stale path
    expect(ref.openFileCalls).not.toContain("subdir/found.md");
  });

  it("opens the default document when lazy search completes without project switch", async () => {
    const listChildrenDeferred = createDeferred<FileEntry[]>();
    const listChildren = vi.fn(async () => listChildrenDeferred.promise);
    const workspaceRequestRef = { current: 1 };
    const windowState = createMockWindowState({
      currentDocument: null,
      sidebarWidth: 220,
    });
    const { Harness, ref } = createHarness({
      fileTree: createFileTree("", [
        {
          name: "subdir",
          path: "subdir",
          isDirectory: true,
          children: undefined,
        },
      ]),
      listChildren,
      workspaceRequestRef,
      windowState,
    });

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    // Lazy search completes without generation change
    await act(async () => {
      listChildrenDeferred.resolve([
        { name: "found.md", path: "subdir/found.md", isDirectory: false },
      ]);
      await Promise.resolve();
    });

    // Should open the found document
    expect(ref.openFileCalls).toContain("subdir/found.md");
  });

  it("prefers previously saved document over default search", async () => {
    const listChildren = vi.fn();
    const workspaceRequestRef = { current: 0 };
    const windowState = createMockWindowState({
      currentDocument: { path: "saved.md", name: "saved.md" },
      sidebarWidth: 220,
    });
    const { Harness, ref } = createHarness({
      fileTree: createFileTree("", [
        { name: "saved.md", path: "saved.md", isDirectory: false },
        { name: "other.md", path: "other.md", isDirectory: false },
      ]),
      listChildren,
      workspaceRequestRef,
      windowState,
    });

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    // Should try to open the saved document first
    expect(ref.openFileCalls[0]).toBe("saved.md");
    // Should NOT call listChildren if saved document is found
    expect(listChildren).not.toHaveBeenCalled();
  });

  it("continues to default search when saved document no longer exists", async () => {
    const listChildrenDeferred = createDeferred<FileEntry[]>();
    const listChildren = vi.fn(async () => listChildrenDeferred.promise);
    const workspaceRequestRef = { current: 0 };
    const windowState = createMockWindowState({
      currentDocument: { path: "deleted.md", name: "deleted.md" },
      sidebarWidth: 220,
    });
    const { Harness, ref } = createHarness({
      fileTree: createFileTree("", [
        {
          name: "subdir",
          path: "subdir",
          isDirectory: true,
          children: undefined,
        },
      ]),
      listChildren,
      workspaceRequestRef,
      windowState,
      openFileShouldReject: true, // openFile("deleted.md") will fail
    });

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    // Should fall back to default search
    await act(async () => {
      listChildrenDeferred.resolve([
        { name: "main.md", path: "subdir/main.md", isDirectory: false },
      ]);
      await Promise.resolve();
    });

    expect(ref.openFileCalls).toContain("subdir/main.md");
  });

  it("browser mode: opens default document from fully-loaded tree without listChildren", async () => {
    const workspaceRequestRef = { current: 0 };
    const windowState = createMockWindowState({
      currentDocument: null,
      sidebarWidth: 220,
    });
    const { Harness, ref } = createHarness({
      fileTree: createFileTree("", [
        { name: "index.md", path: "index.md", isDirectory: false },
        { name: "other.md", path: "other.md", isDirectory: false },
      ]),
      // No listChildren — browser mode
      workspaceRequestRef,
      windowState,
    });

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    // Should find and open index.md from pre-loaded tree
    expect(ref.openFileCalls).toContain("index.md");
  });

  it("handles multiple overlapping restore operations with stale guard", async () => {
    // Test scenario: Two rapid fileTree updates (e.g., project A then project B)
    // Project B's generation is higher, so project A's lazy results should be discarded.
    const listChildrenA = createDeferred<FileEntry[]>();
    const listChildrenB = createDeferred<FileEntry[]>();
    let callCount = 0;
    const listChildren = vi.fn(async () => {
      callCount++;
      return callCount === 1 ? listChildrenA.promise : listChildrenB.promise;
    });
    const workspaceRequestRef = { current: 1 };
    const windowState = createMockWindowState({
      currentDocument: null,
      sidebarWidth: 220,
    });
    const { Harness, ref } = createHarness({
      fileTree: createFileTree("", [
        {
          name: "subdir",
          path: "subdir",
          isDirectory: true,
          children: undefined,
        },
      ]),
      listChildren,
      workspaceRequestRef,
      windowState,
    });

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    // First restore starts (generation 1)
    await act(async () => {
      await Promise.resolve();
    });

    // Project switches, generation becomes 2
    workspaceRequestRef.current = 2;

    // Now resolve first result — should be discarded
    await act(async () => {
      listChildrenA.resolve([
        { name: "a.md", path: "subdir/a.md", isDirectory: false },
      ]);
      await Promise.resolve();
    });

    // Only the second result should be opened
    expect(ref.openFileCalls).not.toContain("subdir/a.md");
  });

  it("does not open any file when fileTree is null", async () => {
    const workspaceRequestRef = { current: 0 };
    const windowState = createMockWindowState({
      currentDocument: null,
      sidebarWidth: 220,
    });
    const { Harness, ref } = createHarness({
      fileTree: null,
      workspaceRequestRef,
      windowState,
    });

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    expect(ref.openFileCalls).toHaveLength(0);
  });

  it("waits for startupComplete before restoring the saved document", async () => {
    const workspaceRequestRef = { current: 0 };
    const windowState = createMockWindowState({
      currentDocument: { path: "draft.md", name: "draft.md" },
      sidebarWidth: 220,
    });
    const deps = {
      fileTree: createFileTree("draft.md"),
      workspaceRequestRef,
      windowState,
      startupComplete: false,
    };
    const { Harness, ref } = createHarness(deps);

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    expect(ref.openFileCalls).toEqual([]);

    deps.startupComplete = true;
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    expect(ref.openFileCalls).toContain("draft.md");
  });

  it("captures generation at restore start to prevent cross-project file paths", async () => {
    // This test verifies the exact behavior described in the issue:
    // capturing gen = workspaceRequestRef.current at the start ensures
    // that if the project changes during lazy search, the returned path
    // (which might belong to new project's namespace) is discarded.
    const listChildrenDeferred = createDeferred<FileEntry[]>();
    const listChildren = vi.fn(async () => listChildrenDeferred.promise);
    const workspaceRequestRef = { current: 5 };
    const windowState = createMockWindowState({
      currentDocument: null,
      sidebarWidth: 220,
    });
    const { Harness, ref } = createHarness({
      fileTree: createFileTree("", [
        {
          name: "docs",
          path: "docs",
          isDirectory: true,
          children: undefined,
        },
      ]),
      listChildren,
      workspaceRequestRef,
      windowState,
    });

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    // Simulate workspace changing before listChildren resolves
    // (generation incremented by project switch)
    workspaceRequestRef.current = 6;

    // The lazy search completes — but result should be discarded
    // because generation changed
    await act(async () => {
      listChildrenDeferred.resolve([
        // These files belong to the NEW project's namespace,
        // not the original project where the search started
        { name: "new-file.md", path: "docs/new-file.md", isDirectory: false },
      ]);
      await Promise.resolve();
    });

    // Stale result must not be opened
    expect(ref.openFileCalls).not.toContain("docs/new-file.md");
  });

  it("restores a confirmed hot-exit backup before normal document restore", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const recoveryStore = createRecoveryStore({
      listBackups: vi.fn(async () => [{
        bytes: 100,
        contentHash: "hash",
        id: "backup-id",
        name: "draft.md",
        path: "draft.md",
        projectKey: "project",
        projectRoot: "/project",
        updatedAt: 100,
      }]),
      readBackup: vi.fn(async () => ({
        version: 1 as const,
        id: "backup-id",
        projectRoot: "/project",
        projectKey: "project",
        path: "draft.md",
        name: "draft.md",
        content: "recovered draft",
        contentHash: "hash",
        baselineHash: "baseline",
        createdAt: 50,
        updatedAt: 100,
      })),
    });
    const windowState = createMockWindowState({
      projectRoot: "/project",
      currentDocument: { path: "draft.md", name: "draft.md" },
      sidebarWidth: 220,
    });
    const { Harness, ref } = createHarness({
      fileTree: createFileTree("draft.md"),
      hotExitBackupStore: recoveryStore,
      workspaceRequestRef: { current: 0 },
      windowState,
    });

    act(() => {
      root.render(createElement(Harness));
    });

    await vi.waitFor(() => {
      expect(ref.restoreDocumentFromRecoveryCalls).toEqual([{
        baselineHash: "baseline",
        path: "draft.md",
        content: "recovered draft",
      }]);
    });
    expect(ref.openFileCalls).toEqual([]);
    expect(confirm).toHaveBeenCalledWith('Recover unsaved changes for "draft.md"?');
    confirm.mockRestore();
  });

  it("keeps the backup and continues normal restore when recovery is skipped", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const recoveryStore = createRecoveryStore({
      listBackups: vi.fn(async () => [{
        bytes: 100,
        contentHash: "hash",
        id: "backup-id",
        name: "draft.md",
        path: "draft.md",
        projectKey: "project",
        projectRoot: "/project",
        updatedAt: 100,
      }]),
      readBackup: vi.fn(async () => {
        throw new Error("should not read skipped backup");
      }),
    });
    const windowState = createMockWindowState({
      projectRoot: "/project",
      currentDocument: { path: "draft.md", name: "draft.md" },
      sidebarWidth: 220,
    });
    const { Harness, ref } = createHarness({
      fileTree: createFileTree("draft.md"),
      hotExitBackupStore: recoveryStore,
      workspaceRequestRef: { current: 0 },
      windowState,
    });

    act(() => {
      root.render(createElement(Harness));
    });

    await vi.waitFor(() => {
      expect(ref.openFileCalls).toContain("draft.md");
    });
    expect(ref.restoreDocumentFromRecoveryCalls).toEqual([]);
    expect(recoveryStore.readBackup).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("continues normal restore when the hot-exit backup store fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoveryStore = createRecoveryStore({
      listBackups: vi.fn(async () => {
        throw new Error("recovery unavailable");
      }),
    });
    const windowState = createMockWindowState({
      projectRoot: "/project",
      currentDocument: { path: "draft.md", name: "draft.md" },
      sidebarWidth: 220,
    });
    const { Harness, ref } = createHarness({
      fileTree: createFileTree("draft.md"),
      hotExitBackupStore: recoveryStore,
      workspaceRequestRef: { current: 0 },
      windowState,
    });

    act(() => {
      root.render(createElement(Harness));
    });

    await vi.waitFor(() => {
      expect(ref.openFileCalls).toContain("draft.md");
    });
    expect(ref.restoreDocumentFromRecoveryCalls).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      "[session] failed to restore hot-exit backup:",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("continues normal restore when the selected hot-exit backup cannot be read", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoveryStore = createRecoveryStore({
      listBackups: vi.fn(async () => [{
        bytes: 100,
        contentHash: "hash",
        id: "backup-id",
        name: "draft.md",
        path: "draft.md",
        projectKey: "project",
        projectRoot: "/project",
        updatedAt: 100,
      }]),
      readBackup: vi.fn(async () => {
        throw new Error("backup unreadable");
      }),
    });
    const windowState = createMockWindowState({
      projectRoot: "/project",
      currentDocument: { path: "draft.md", name: "draft.md" },
      sidebarWidth: 220,
    });
    const { Harness, ref } = createHarness({
      fileTree: createFileTree("draft.md"),
      hotExitBackupStore: recoveryStore,
      workspaceRequestRef: { current: 0 },
      windowState,
    });

    act(() => {
      root.render(createElement(Harness));
    });

    await vi.waitFor(() => {
      expect(ref.openFileCalls).toContain("draft.md");
    });
    expect(ref.restoreDocumentFromRecoveryCalls).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      "[session] failed to restore hot-exit backup:",
      expect.any(Error),
    );
    confirm.mockRestore();
    consoleError.mockRestore();
  });

  it("stops calling listChildren after workspace generation changes mid-search", async () => {
    // Regression test for #703: verify that the guarded listChildren wrapper
    // actually prevents subsequent listChildren calls when the workspace
    // generation changes, rather than just discarding the final result.
    const firstDeferred = createDeferred<FileEntry[]>();
    const listChildren = vi.fn(async (path: string) => {
      if (path === "a") return firstDeferred.promise;
      // "b" should never be called if cancellation works
      return [{ name: "b.md", path: "b/b.md", isDirectory: false }];
    });
    const workspaceRequestRef = { current: 1 };
    const windowState = createMockWindowState({
      currentDocument: null,
      sidebarWidth: 220,
    });
    const { Harness, ref } = createHarness({
      fileTree: createFileTree("", [
        { name: "a", path: "a", isDirectory: true, children: undefined },
        { name: "b", path: "b", isDirectory: true, children: undefined },
      ]),
      listChildren,
      workspaceRequestRef,
      windowState,
    });

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    // listChildren("a") is now in flight
    expect(listChildren).toHaveBeenCalledWith("a");

    // Simulate project switch while listChildren("a") is awaiting
    workspaceRequestRef.current = 2;

    // Resolve first listChildren — the guarded wrapper should detect
    // the generation change and abort the signal
    await act(async () => {
      firstDeferred.resolve([
        { name: "a.md", path: "a/a.md", isDirectory: false },
      ]);
      await Promise.resolve();
    });

    // The key assertion: listChildren should NOT have been called for "b"
    // because the signal was aborted after "a" resolved with a stale generation
    expect(listChildren).not.toHaveBeenCalledWith("b");
    expect(ref.openFileCalls).toHaveLength(0);
  });
});
