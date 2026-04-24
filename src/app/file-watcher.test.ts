import { describe, expect, it, vi } from "vitest";
import type { ExternalDocumentSyncResult } from "./editor-session-service";
import type { FileWatcherStatus } from "./file-watcher";

const watcherBackendState = vi.hoisted(() => {
  interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
  }
  type Listener = (event: { payload: unknown }) => void;
  type ListenerEntry = { eventName: string; listener: Listener };

  const createDeferred = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((innerResolve) => {
      resolve = innerResolve;
    });
    return { promise, resolve };
  };

  const listenDeferred = createDeferred<() => void>();
  return {
    watchDirectoryCommand: vi.fn(async () => ({ applied: true, root: "/tmp/project-a" })),
    unwatchDirectoryCommand: vi.fn(async () => true),
    listeners: [] as ListenerEntry[],
    createDeferred,
    listen: vi.fn(async (eventName: string, listener: Listener) => {
      watcherBackendState.listeners.push({ eventName, listener });
      return watcherBackendState.listenDeferred.promise;
    }),
    listenDeferred,
    emit(eventNameOrPayload: string | unknown, payload?: unknown) {
      if (typeof eventNameOrPayload === "string" && payload !== undefined) {
        for (const entry of this.listeners) {
          if (entry.eventName === eventNameOrPayload) {
            entry.listener({ payload });
          }
        }
        return;
      }
      for (const entry of this.listeners) {
        entry.listener({ payload: eventNameOrPayload });
      }
    },
    reset() {
      this.watchDirectoryCommand.mockClear();
      this.watchDirectoryCommand.mockImplementation(async () => ({
        applied: true,
        root: "/tmp/project-a",
      }));
      this.unwatchDirectoryCommand.mockClear();
      this.unwatchDirectoryCommand.mockImplementation(async () => true);
      this.listen.mockClear();
      this.listeners = [];
      this.listenDeferred = createDeferred<() => void>();
      this.listen.mockImplementation(async (eventName: string, listener: Listener) => {
        watcherBackendState.listeners.push({ eventName, listener });
        return watcherBackendState.listenDeferred.promise;
      });
    },
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: watcherBackendState.listen,
}));

vi.mock("./tauri-client/watch", () => ({
  WATCH_STATUS_EVENT: "watch-status",
  watchDirectoryCommand: watcherBackendState.watchDirectoryCommand,
  unwatchDirectoryCommand: watcherBackendState.unwatchDirectoryCommand,
}));

import { FileWatcher } from "./file-watcher";

function createWatcher(
  options: {
    refreshTree?: (path?: string) => Promise<void>;
    handleWatchedPathChange?: (path: string) => void | Promise<void>;
    syncExternalChange?: (path: string) => Promise<ExternalDocumentSyncResult>;
    handleWatcherStatus?: (status: FileWatcherStatus) => void | Promise<void>;
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
    handleWatcherStatus: options.handleWatcherStatus,
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
      expect(watcherBackendState.listen).toHaveBeenCalledWith("watch-status", expect.any(Function));
    });

    await watcher.unwatch();
    expect(watcherBackendState.unwatchDirectoryCommand).toHaveBeenCalledTimes(1);
    expect(watcherBackendState.unwatchDirectoryCommand).toHaveBeenNthCalledWith(1, expect.any(Number));

    watcherBackendState.listenDeferred.resolve(unlisten);
    await watchPromise;

    expect(unlisten).toHaveBeenCalledTimes(2);
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
      expect(watcherBackendState.listen).toHaveBeenCalledTimes(2);
    });
    expect(watcherBackendState.watchDirectoryCommand).not.toHaveBeenCalled();

    watcherBackendState.listenDeferred.resolve(unlisten);
    await watchPromise;

    expect(watcherBackendState.watchDirectoryCommand).toHaveBeenCalledWith(
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
    const firstStatusUnlisten = vi.fn();
    const secondUnlisten = vi.fn();
    const secondStatusUnlisten = vi.fn();
    const firstListenDeferred = watcherBackendState.listenDeferred;
    const firstStatusListenDeferred = watcherBackendState.createDeferred<() => void>();
    const listenQueue = [
      firstListenDeferred.promise,
      firstStatusListenDeferred.promise,
      Promise.resolve(secondUnlisten),
      Promise.resolve(secondStatusUnlisten),
    ];
    watcherBackendState.listen.mockImplementation((_eventName: string, listener: (event: { payload: unknown }) => void) => {
      watcherBackendState.listeners.push({ eventName: _eventName, listener });
      return listenQueue.shift() ?? Promise.resolve(vi.fn());
    });

    const first = createWatcher().watcher;
    const second = createWatcher().watcher;

    const firstWatch = first.watch("/tmp/project-a");
    await vi.waitFor(() => {
      expect(watcherBackendState.listen).toHaveBeenCalledTimes(2);
    });
    const secondWatch = second.watch("/tmp/project-a");

    firstListenDeferred.resolve(firstUnlisten);
    firstStatusListenDeferred.resolve(firstStatusUnlisten);
    await firstWatch;
    await secondWatch;

    expect(firstUnlisten).toHaveBeenCalledTimes(1);
    expect(firstStatusUnlisten).toHaveBeenCalledTimes(1);
    expect(secondUnlisten).not.toHaveBeenCalled();
    expect(secondStatusUnlisten).not.toHaveBeenCalled();
    expect(watcherBackendState.watchDirectoryCommand).toHaveBeenCalledTimes(1);
    expect(watcherBackendState.watchDirectoryCommand).toHaveBeenNthCalledWith(
      1,
      expect.any(Number),
      500,
    );
    const [secondCall = [] as unknown[]] =
      watcherBackendState.watchDirectoryCommand.mock.calls;
    const unwatchCalls = watcherBackendState.unwatchDirectoryCommand.mock.calls as Array<unknown[]>;
    const secondToken = secondCall[0];
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
    const watchToken = watchCall[0];
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
      watcherBackendState.listeners.push({ eventName: _eventName, listener });
      return () => {};
    });
    watcherBackendState.watchDirectoryCommand.mockImplementation(async () => ({
      applied: true,
      root: "/tmp/project-a-canonical",
    }));
    const syncExternalChange = vi.fn(async () => "ignore" as const);
    const { watcher } = createWatcher({ syncExternalChange });

    await watcher.watch("/tmp/project-a");
    const [watchCall = [] as unknown[]] = watcherBackendState.watchDirectoryCommand.mock.calls;
    const watchToken = watchCall[0] as number;

    const fileChangedListener = watcherBackendState.listeners.find(
      (entry) => entry.eventName === "file-changed",
    )?.listener;
    expect(fileChangedListener).toBeDefined();

    fileChangedListener?.({ payload: {
      path: "stale-generation.md",
      treeChanged: false,
      generation: watchToken - 1,
      root: "/tmp/project-a-canonical",
    } });
    fileChangedListener?.({ payload: {
      path: "stale-root.md",
      treeChanged: false,
      generation: watchToken,
      root: "/tmp/project-b",
    } });
    fileChangedListener?.({ payload: {
      path: "current.md",
      treeChanged: false,
      generation: watchToken,
      root: "/tmp/project-a-canonical",
    } });

    await vi.waitFor(() => {
      expect(syncExternalChange).toHaveBeenCalledTimes(1);
    });
    expect(syncExternalChange).toHaveBeenCalledWith("current.md");
  });

  it("records and forwards native watcher health events", async () => {
    watcherBackendState.reset();
    watcherBackendState.listen.mockImplementation(async (eventName: string, listener: (event: { payload: unknown }) => void) => {
      watcherBackendState.listeners.push({ eventName, listener });
      return () => {};
    });
    watcherBackendState.watchDirectoryCommand.mockImplementation(async () => ({
      applied: true,
      root: "/tmp/project-a-canonical",
    }));
    const handleWatcherStatus = vi.fn();
    const { watcher } = createWatcher({ handleWatcherStatus });

    await watcher.watch("/tmp/project-a");
    const [watchCall = [] as unknown[]] = watcherBackendState.watchDirectoryCommand.mock.calls;
    const watchToken = watchCall[0] as number;

    watcherBackendState.emit("watch-status", {
      status: "degraded",
      generation: watchToken,
      root: "/tmp/project-a-canonical",
      message: "Native watcher reported an error",
      error: "backend unavailable",
    });

    expect(watcher.getStatus()).toMatchObject({
      status: "degraded",
      generation: watchToken,
      root: "/tmp/project-a-canonical",
      message: "Native watcher reported an error",
      error: "backend unavailable",
    });
    expect(handleWatcherStatus).toHaveBeenCalledWith(expect.objectContaining({
      status: "degraded",
      generation: watchToken,
      root: "/tmp/project-a-canonical",
    }));
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

  it("routes modify-only coflat.yaml events through the watched-path handler without tree refresh", async () => {
    const refreshTree = vi.fn(async (_path?: string) => {});
    const handleWatchedPathChange = vi.fn();
    const { watcher, refreshTree: refreshTreeSpy } = createWatcher({
      refreshTree,
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

    await handleFileChanged({ path: "coflat.yaml", treeChanged: false });

    expect(handleWatchedPathChange).toHaveBeenCalledWith("coflat.yaml");
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
