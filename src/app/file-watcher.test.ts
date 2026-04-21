import { describe, expect, it, vi } from "vitest";
import type { ExternalDocumentSyncResult } from "./editor-session-service";

const watcherBackendState = vi.hoisted(() => {
  interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
  }
  type Listener = (event: { payload: unknown }) => void;

  const createDeferred = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((innerResolve) => {
      resolve = innerResolve;
    });
    return { promise, resolve };
  };

  const listenDeferred = createDeferred<() => void>();
  return {
    watchDirectoryCommand: vi.fn(async (path: string) => ({ applied: true, root: path })),
    unwatchDirectoryCommand: vi.fn(async () => true),
    listeners: [] as Listener[],
    listen: vi.fn(async (_eventName: string, listener: Listener) => {
      watcherBackendState.listeners.push(listener);
      return watcherBackendState.listenDeferred.promise;
    }),
    listenDeferred,
    emit(payload: unknown) {
      for (const listener of this.listeners) {
        listener({ payload });
      }
    },
    reset() {
      this.watchDirectoryCommand.mockClear();
      this.watchDirectoryCommand.mockImplementation(async (path: string) => ({
        applied: true,
        root: path,
      }));
      this.unwatchDirectoryCommand.mockClear();
      this.unwatchDirectoryCommand.mockImplementation(async () => true);
      this.listen.mockClear();
      this.listeners = [];
      this.listenDeferred = createDeferred<() => void>();
      this.listen.mockImplementation(async (_eventName: string, listener: Listener) => {
        this.listeners.push(listener);
        return this.listenDeferred.promise;
      });
    },
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: watcherBackendState.listen,
}));

vi.mock("./tauri-client/watch", () => ({
  watchDirectoryCommand: watcherBackendState.watchDirectoryCommand,
  unwatchDirectoryCommand: watcherBackendState.unwatchDirectoryCommand,
}));

import { FileWatcher } from "./file-watcher";

function createWatcher(
  options: {
    refreshTree?: (path?: string) => Promise<void>;
    handleWatchedPathChange?: (path: string) => void | Promise<void>;
    syncExternalChange?: (path: string) => Promise<ExternalDocumentSyncResult>;
  } = {},
) {
  const refreshTree =
    options.refreshTree ?? vi.fn(async (_path?: string) => {});
  const handleWatchedPathChange =
    options.handleWatchedPathChange ?? vi.fn();
  const syncExternalChange =
    options.syncExternalChange ?? vi.fn(async () => "notify" as const);
  const watcher = new FileWatcher({
    refreshTree,
    handleWatchedPathChange,
    syncExternalChange,
  });

  return {
    watcher,
    refreshTree,
    handleWatchedPathChange,
    syncExternalChange,
  };
}

describe("FileWatcher", () => {
  it("drops a late listener registration after unwatch", async () => {
    watcherBackendState.reset();
    const unlisten = vi.fn();
    const { watcher } = createWatcher();

    const watchPromise = watcher.watch("/tmp/project-a");
    await vi.waitFor(() => {
      expect(watcherBackendState.listen).toHaveBeenCalledWith("file-changed", expect.any(Function));
    });

    await watcher.unwatch();
    expect(watcherBackendState.unwatchDirectoryCommand).toHaveBeenCalledTimes(1);
    expect(watcherBackendState.unwatchDirectoryCommand).toHaveBeenNthCalledWith(1, expect.any(Number));

    watcherBackendState.listenDeferred.resolve(unlisten);
    await watchPromise;

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(watcherBackendState.watchDirectoryCommand).not.toHaveBeenCalled();
    expect(watcherBackendState.unwatchDirectoryCommand).toHaveBeenCalledTimes(2);
    expect(watcherBackendState.unwatchDirectoryCommand).toHaveBeenNthCalledWith(2, expect.any(Number));
  });

  it("registers the frontend listener before starting the backend watcher", async () => {
    watcherBackendState.reset();
    const unlisten = vi.fn();
    const { watcher } = createWatcher();

    const watchPromise = watcher.watch("/tmp/project-a");
    await vi.waitFor(() => {
      expect(watcherBackendState.listen).toHaveBeenCalledTimes(1);
    });
    expect(watcherBackendState.watchDirectoryCommand).not.toHaveBeenCalled();

    watcherBackendState.listenDeferred.resolve(unlisten);
    await watchPromise;

    expect(watcherBackendState.watchDirectoryCommand).toHaveBeenCalledWith(
      "/tmp/project-a",
      expect.any(Number),
      500,
    );
    expect(watcherBackendState.listen.mock.invocationCallOrder[0]).toBeLessThan(
      watcherBackendState.watchDirectoryCommand.mock.invocationCallOrder[0],
    );
  });

  it("drops a stale listener when a newer watcher instance takes over", async () => {
    watcherBackendState.reset();
    const firstUnlisten = vi.fn();
    const secondUnlisten = vi.fn();
    const firstListenDeferred = watcherBackendState.listenDeferred;
    const secondListenDeferred = {
      promise: Promise.resolve(secondUnlisten),
      resolve: (_value: () => void) => {},
    };

    const listenQueue = [firstListenDeferred.promise, secondListenDeferred.promise];
    watcherBackendState.listen.mockImplementation((_eventName: string, listener: (event: { payload: unknown }) => void) => {
      watcherBackendState.listeners.push(listener);
      return listenQueue.shift() ?? Promise.resolve(vi.fn());
    });

    const first = createWatcher().watcher;
    const second = createWatcher().watcher;

    const firstWatch = first.watch("/tmp/project-a");
    await vi.waitFor(() => {
      expect(watcherBackendState.listen).toHaveBeenCalledTimes(1);
    });
    const secondWatch = second.watch("/tmp/project-a");

    firstListenDeferred.resolve(firstUnlisten);
    await firstWatch;
    await secondWatch;

    expect(firstUnlisten).toHaveBeenCalledTimes(1);
    expect(secondUnlisten).not.toHaveBeenCalled();
    expect(watcherBackendState.watchDirectoryCommand).toHaveBeenCalledTimes(1);
    expect(watcherBackendState.watchDirectoryCommand).toHaveBeenNthCalledWith(
      1,
      "/tmp/project-a",
      expect.any(Number),
      500,
    );
    const [secondCall = [] as unknown[]] =
      watcherBackendState.watchDirectoryCommand.mock.calls;
    const unwatchCalls = watcherBackendState.unwatchDirectoryCommand.mock.calls as Array<unknown[]>;
    const secondToken = secondCall[1];
    expect(
      unwatchCalls.some((call) => call[0] === secondToken),
    ).toBe(false);
  });

  it("warns when backend unwatch fails during teardown but still resolves", async () => {
    watcherBackendState.reset();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    watcherBackendState.listen.mockResolvedValue(vi.fn());
    watcherBackendState.unwatchDirectoryCommand.mockRejectedValueOnce(new Error("backend stopped"));
    const { watcher } = createWatcher();

    await watcher.watch("/tmp/project-a");
    const [watchCall = [] as unknown[]] = watcherBackendState.watchDirectoryCommand.mock.calls;
    const watchToken = watchCall[1];
    await expect(watcher.unwatch()).resolves.toBeUndefined();

    expect(consoleWarn).toHaveBeenCalledWith(
      "[file-watcher] failed to stop backend watcher during teardown",
      watchToken,
      expect.any(Error),
    );
    consoleWarn.mockRestore();
  });

  it("ignores stale backend events with the wrong generation or root", async () => {
    watcherBackendState.reset();
    watcherBackendState.listen.mockImplementation(async (_eventName: string, listener: (event: { payload: unknown }) => void) => {
      watcherBackendState.listeners.push(listener);
      return () => {};
    });
    watcherBackendState.watchDirectoryCommand.mockImplementation(async (_path: string) => ({
      applied: true,
      root: "/tmp/project-a-canonical",
    }));
    const syncExternalChange = vi.fn(async () => "ignore" as const);
    const { watcher } = createWatcher({ syncExternalChange });

    await watcher.watch("/tmp/project-a");
    const [watchCall = [] as unknown[]] = watcherBackendState.watchDirectoryCommand.mock.calls;
    const watchToken = watchCall[1] as number;

    watcherBackendState.emit({
      path: "stale-generation.md",
      treeChanged: false,
      generation: watchToken - 1,
      root: "/tmp/project-a-canonical",
    });
    watcherBackendState.emit({
      path: "stale-root.md",
      treeChanged: false,
      generation: watchToken,
      root: "/tmp/project-b",
    });
    watcherBackendState.emit({
      path: "current.md",
      treeChanged: false,
      generation: watchToken,
      root: "/tmp/project-a-canonical",
    });

    await vi.waitFor(() => {
      expect(syncExternalChange).toHaveBeenCalledTimes(1);
    });
    expect(syncExternalChange).toHaveBeenCalledWith("current.md");
  });

  it("leaves dirty conflict presentation to the session state", async () => {
    const syncExternalChange = vi.fn(async () => "notify" as const);
    const { watcher } = createWatcher({ syncExternalChange });
    const handleFileChanged = (watcher as unknown as { handleFileChanged: (path: string) => Promise<void> })
      .handleFileChanged
      .bind(watcher as unknown as { handleFileChanged: (path: string) => Promise<void> });

    await handleFileChanged("a.md");
    await handleFileChanged("b.md");

    expect(syncExternalChange).toHaveBeenCalledWith("a.md");
    expect(syncExternalChange).toHaveBeenCalledWith("b.md");
  });

  it("refreshes the tree for structural changes even when the path is not open", async () => {
    const refreshTree = vi.fn(async (_path?: string) => {});
    const { watcher, refreshTree: refreshTreeSpy } = createWatcher({
      refreshTree,
      syncExternalChange: async () => "ignore",
    });
    const handleFileChanged = (
      watcher as unknown as {
        handleFileChanged: (payload: { path: string; treeChanged: boolean }) => Promise<void>;
      }
    ).handleFileChanged.bind(watcher as unknown as {
      handleFileChanged: (payload: { path: string; treeChanged: boolean }) => Promise<void>;
    });

    await handleFileChanged({ path: "docs/new-subdir", treeChanged: true });

    await vi.waitFor(() => {
      expect(refreshTreeSpy).toHaveBeenCalledWith("docs/new-subdir");
    });
  });

  it("coalesces structural refreshes by parent directory", async () => {
    const refreshTree = vi.fn(async (_path?: string) => {});
    const { watcher, refreshTree: refreshTreeSpy } = createWatcher({
      refreshTree,
      syncExternalChange: async () => "ignore",
    });
    const handleFileChanged = (
      watcher as unknown as {
        handleFileChanged: (payload: { path: string; treeChanged: boolean }) => Promise<void>;
      }
    ).handleFileChanged.bind(watcher as unknown as {
      handleFileChanged: (payload: { path: string; treeChanged: boolean }) => Promise<void>;
    });

    await Promise.all([
      handleFileChanged({ path: "docs/a.md", treeChanged: true }),
      handleFileChanged({ path: "docs/b.md", treeChanged: true }),
      handleFileChanged({ path: "notes/c.md", treeChanged: true }),
    ]);

    await vi.waitFor(() => {
      expect(refreshTreeSpy).toHaveBeenCalledTimes(2);
    });
    expect(refreshTreeSpy).toHaveBeenCalledWith("docs/a.md");
    expect(refreshTreeSpy).toHaveBeenCalledWith("notes/c.md");
  });

  it("skips structural refreshes for self-originated save events", async () => {
    const refreshTree = vi.fn(async (_path?: string) => {});
    const { watcher, refreshTree: refreshTreeSpy } = createWatcher({
      refreshTree,
      syncExternalChange: async () => "self-change",
    });
    const handleFileChanged = (
      watcher as unknown as {
        handleFileChanged: (payload: { path: string; treeChanged: boolean }) => Promise<void>;
      }
    ).handleFileChanged.bind(watcher as unknown as {
      handleFileChanged: (payload: { path: string; treeChanged: boolean }) => Promise<void>;
    });

    await handleFileChanged({ path: "docs/a.md", treeChanged: true });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(refreshTreeSpy).not.toHaveBeenCalled();
  });

  it("does not refresh the tree for non-structural file modifications", async () => {
    const refreshTree = vi.fn(async (_path?: string) => {});
    const { watcher, refreshTree: refreshTreeSpy } = createWatcher({
      refreshTree,
      syncExternalChange: async () => "ignore",
    });
    const handleFileChanged = (
      watcher as unknown as {
        handleFileChanged: (payload: { path: string; treeChanged: boolean }) => Promise<void>;
      }
    ).handleFileChanged.bind(watcher as unknown as {
      handleFileChanged: (payload: { path: string; treeChanged: boolean }) => Promise<void>;
    });

    await handleFileChanged({ path: "docs/a.md", treeChanged: false });

    expect(refreshTreeSpy).not.toHaveBeenCalled();
  });

  it("runs the watched-path handler even when the changed file is not open", async () => {
    const handleWatchedPathChange = vi.fn();
    const { watcher } = createWatcher({
      handleWatchedPathChange,
      syncExternalChange: async () => "ignore",
    });
    const handleFileChanged = (
      watcher as unknown as {
        handleFileChanged: (payload: { path: string; treeChanged: boolean }) => Promise<void>;
      }
    ).handleFileChanged.bind(watcher as unknown as {
      handleFileChanged: (payload: { path: string; treeChanged: boolean }) => Promise<void>;
    });

    await handleFileChanged({ path: "assets/diagram.png", treeChanged: false });

    expect(handleWatchedPathChange).toHaveBeenCalledWith("assets/diagram.png");
  });

  it("does not refresh the tree when the session already reloaded a clean file", async () => {
    const refreshTree = vi.fn(async (_path?: string) => {});
    const { watcher, refreshTree: refreshTreeSpy } = createWatcher({
      refreshTree,
      syncExternalChange: async () => "reloaded",
    });
    const handleFileChanged = (
      watcher as unknown as {
        handleFileChanged: (payload: { path: string; treeChanged: boolean }) => Promise<void>;
      }
    ).handleFileChanged.bind(watcher as unknown as {
      handleFileChanged: (payload: { path: string; treeChanged: boolean }) => Promise<void>;
    });

    await handleFileChanged({ path: "a.md", treeChanged: false });

    expect(refreshTreeSpy).not.toHaveBeenCalled();
  });
});
