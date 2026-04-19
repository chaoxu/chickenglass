import { describe, expect, it, vi } from "vitest";
import type { ExternalDocumentSyncResult } from "./editor-session-service";

const watcherBackendState = vi.hoisted(() => {
  interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
  }

  const createDeferred = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((innerResolve) => {
      resolve = innerResolve;
    });
    return { promise, resolve };
  };

  const listenDeferred = createDeferred<() => void>();
  return {
    watchDirectoryCommand: vi.fn(async () => true),
    unwatchDirectoryCommand: vi.fn(async () => true),
    listener: null as null | ((event: { payload: unknown }) => void),
    listen: vi.fn(async () => listenDeferred.promise),
    listenDeferred,
    reset() {
      this.watchDirectoryCommand.mockClear();
      this.watchDirectoryCommand.mockImplementation(async () => true);
      this.unwatchDirectoryCommand.mockClear();
      this.unwatchDirectoryCommand.mockImplementation(async () => true);
      this.listener = null;
      this.listen.mockClear();
      this.listenDeferred = createDeferred<() => void>();
      this.listen.mockImplementation(async (_eventName: string, handler: (event: { payload: unknown }) => void) => {
        this.listener = handler;
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

function processFileChanged(watcher: FileWatcher) {
  return watcher.processFileChanged.bind(watcher);
}

function createWatcher(
  options: {
    refreshTree?: (path?: string) => Promise<void>;
    reloadFile?: (path: string) => Promise<void>;
    handleWatchedPathChange?: (path: string) => void | Promise<void>;
    syncExternalChange?: (path: string) => Promise<ExternalDocumentSyncResult>;
  } = {},
) {
  const container = document.createElement("div");
  const refreshTree =
    options.refreshTree ?? vi.fn(async (_path?: string) => {});
  const reloadFile =
    options.reloadFile ?? vi.fn(async (_path: string) => {});
  const handleWatchedPathChange =
    options.handleWatchedPathChange ?? vi.fn();
  const syncExternalChange =
    options.syncExternalChange ?? vi.fn(async () => "notify" as const);
  const watcher = new FileWatcher({
    refreshTree,
    reloadFile,
    handleWatchedPathChange,
    syncExternalChange,
    container,
  });

  return {
    container,
    watcher,
    refreshTree,
    reloadFile,
    handleWatchedPathChange,
    syncExternalChange,
  };
}

describe("FileWatcher", () => {
  it("registers the frontend listener before attaching the backend watcher", async () => {
    watcherBackendState.reset();
    const { watcher } = createWatcher();

    const watchPromise = watcher.watch("/tmp/project-a");
    await vi.waitFor(() => {
      expect(watcherBackendState.listen).toHaveBeenCalledTimes(1);
    });

    expect(watcherBackendState.watchDirectoryCommand).not.toHaveBeenCalled();

    watcherBackendState.listenDeferred.resolve(vi.fn());
    await vi.waitFor(() => {
      expect(watcherBackendState.watchDirectoryCommand).toHaveBeenCalledWith(
        "/tmp/project-a",
        expect.any(Number),
      );
    });

    await watchPromise;
  });

  it("drops a late listener registration after unwatch", async () => {
    watcherBackendState.reset();
    const unlisten = vi.fn();
    const { watcher } = createWatcher();

    const watchPromise = watcher.watch("/tmp/project-a");
    await vi.waitFor(() => {
      expect(watcherBackendState.listen).toHaveBeenCalledTimes(1);
    });

    await watcher.unwatch();
    expect(watcherBackendState.watchDirectoryCommand).not.toHaveBeenCalled();
    expect(watcherBackendState.unwatchDirectoryCommand).toHaveBeenCalledTimes(1);
    expect(watcherBackendState.unwatchDirectoryCommand).toHaveBeenNthCalledWith(1, expect.any(Number));

    watcherBackendState.listenDeferred.resolve(unlisten);
    await watchPromise;

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(watcherBackendState.watchDirectoryCommand).not.toHaveBeenCalled();
    expect(watcherBackendState.unwatchDirectoryCommand).toHaveBeenCalledTimes(1);
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

  it("queues dirty-file notifications instead of dropping earlier ones", async () => {
    const { container, watcher } = createWatcher();
    const handleFileChanged = processFileChanged(watcher);

    await handleFileChanged("a.md");
    await handleFileChanged("b.md");

    expect(container.textContent).toContain("\"a.md\" changed externally. Reload?");

    const noButton = container.querySelector<HTMLButtonElement>(".file-watcher-btn-no");
    expect(noButton).not.toBeNull();
    noButton?.click();

    expect(container.textContent).toContain("\"b.md\" changed externally. Reload?");
  });

  it("suppresses duplicate notifications while a file is already pending", async () => {
    const { container, watcher } = createWatcher();
    const handleFileChanged = processFileChanged(watcher);

    await handleFileChanged("a.md");
    await handleFileChanged("a.md");

    expect(container.querySelectorAll(".file-watcher-notification")).toHaveLength(1);
    expect(container.textContent?.match(/a\.md/g)?.length).toBe(1);
  });

  it("reloads the current file and advances to the next pending notification", async () => {
    const reloadFile = vi.fn(async () => {});
    const { container, watcher } = createWatcher({ reloadFile });
    const handleFileChanged = processFileChanged(watcher);

    await handleFileChanged("a.md");
    await handleFileChanged("b.md");

    const yesButton = container.querySelector<HTMLButtonElement>(".file-watcher-btn-yes");
    expect(yesButton).not.toBeNull();
    yesButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(reloadFile).toHaveBeenCalledWith("a.md");
    expect(container.textContent).toContain("\"b.md\" changed externally. Reload?");
  });

  it("catches synchronous reload handler failures and still advances the queue", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const reloadFile = vi.fn<(_: string) => Promise<void>>(() => {
      throw new Error("boom");
    });
    const { container, watcher } = createWatcher({ reloadFile });
    const handleFileChanged = processFileChanged(watcher);

    await handleFileChanged("a.md");
    await handleFileChanged("b.md");

    const yesButton = container.querySelector<HTMLButtonElement>(".file-watcher-btn-yes");
    expect(yesButton).not.toBeNull();
    yesButton?.click();
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith(
      "[file-watcher] reload button handler failed",
      "a.md",
      expect.any(Error),
    );
    expect(container.textContent).toContain("\"b.md\" changed externally. Reload?");
    consoleError.mockRestore();
  });

  it("refreshes the tree for structural changes even when the path is not open", async () => {
    const refreshTree = vi.fn(async (_path?: string) => {});
    const { watcher, refreshTree: refreshTreeSpy } = createWatcher({
      refreshTree,
      syncExternalChange: async () => "ignore",
    });
    const handleFileChanged = processFileChanged(watcher);

    await handleFileChanged({ path: "docs/new-subdir", treeChanged: true });

    expect(refreshTreeSpy).toHaveBeenCalledWith("docs/new-subdir");
  });

  it("does not refresh the tree for non-structural file modifications", async () => {
    const refreshTree = vi.fn(async (_path?: string) => {});
    const { watcher, refreshTree: refreshTreeSpy } = createWatcher({
      refreshTree,
      syncExternalChange: async () => "ignore",
    });
    const handleFileChanged = processFileChanged(watcher);

    await handleFileChanged({ path: "docs/a.md", treeChanged: false });

    expect(refreshTreeSpy).not.toHaveBeenCalled();
  });

  it("runs the watched-path handler even when the changed file is not open", async () => {
    const handleWatchedPathChange = vi.fn();
    const { watcher } = createWatcher({
      handleWatchedPathChange,
      syncExternalChange: async () => "ignore",
    });
    const handleFileChanged = processFileChanged(watcher);

    await handleFileChanged({ path: "assets/diagram.png", treeChanged: false });

    expect(handleWatchedPathChange).toHaveBeenCalledWith("assets/diagram.png");
  });

  it("does not show a notification when the session already reloaded the clean file", async () => {
    const { container, watcher } = createWatcher({
      syncExternalChange: async () => "reloaded",
    });
    const handleFileChanged = processFileChanged(watcher);

    await handleFileChanged({ path: "a.md", treeChanged: false });

    expect(container.querySelector(".file-watcher-notification")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("ignores file-changed events from stale watcher generations", async () => {
    watcherBackendState.reset();
    const syncExternalChange = vi.fn(async () => "notify" as const);
    watcherBackendState.listen.mockImplementation(async (_eventName: string, handler: (event: { payload: unknown }) => void) => {
      watcherBackendState.listener = handler;
      return vi.fn();
    });
    const { watcher } = createWatcher({ syncExternalChange });

    await watcher.watch("/tmp/project-a");
    const [watchCall = [] as unknown[]] = watcherBackendState.watchDirectoryCommand.mock.calls;
    const activeToken = watchCall[1] as number;

    watcherBackendState.listener?.({
      payload: { path: "notes.md", treeChanged: false, generation: activeToken + 1 },
    });
    await Promise.resolve();
    expect(syncExternalChange).not.toHaveBeenCalled();

    watcherBackendState.listener?.({
      payload: { path: "notes.md", treeChanged: false, generation: activeToken },
    });
    await Promise.resolve();
    expect(syncExternalChange).toHaveBeenCalledWith("notes.md");
  });
});
