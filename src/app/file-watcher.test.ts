import { describe, expect, it, vi } from "vitest";

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
    watchDirectoryCommand: vi.fn(async () => {}),
    unwatchDirectoryCommand: vi.fn(async () => {}),
    listen: vi.fn(async () => listenDeferred.promise),
    listenDeferred,
    reset() {
      this.watchDirectoryCommand.mockClear();
      this.unwatchDirectoryCommand.mockClear();
      this.listen.mockClear();
      this.listenDeferred = createDeferred<() => void>();
      this.listen.mockImplementation(async () => this.listenDeferred.promise);
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
  reloadFile: ((path: string) => Promise<void>) = vi.fn(async (_path: string) => {}),
) {
  const container = document.createElement("div");
  const watcher = new FileWatcher({
    isFileOpen: () => true,
    isFileDirty: () => true,
    reloadFile,
    container,
  });

  return { container, watcher, reloadFile };
}

describe("FileWatcher", () => {
  it("drops a late listener registration after unwatch", async () => {
    watcherBackendState.reset();
    const unlisten = vi.fn();
    const { watcher } = createWatcher();

    const watchPromise = watcher.watch("/tmp/project-a");
    await vi.waitFor(() => {
      expect(watcherBackendState.watchDirectoryCommand).toHaveBeenCalledWith("/tmp/project-a");
    });

    await watcher.unwatch();
    expect(watcherBackendState.unwatchDirectoryCommand).toHaveBeenCalledTimes(2);

    watcherBackendState.listenDeferred.resolve(unlisten);
    await watchPromise;

    expect(unlisten).toHaveBeenCalledTimes(1);
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
    watcherBackendState.listen.mockImplementation(() => listenQueue.shift() ?? Promise.resolve(vi.fn()));

    const first = createWatcher().watcher;
    const second = createWatcher().watcher;

    const firstWatch = first.watch("/tmp/project-a");
    const secondWatch = second.watch("/tmp/project-a");

    firstListenDeferred.resolve(firstUnlisten);
    await firstWatch;
    await secondWatch;

    expect(firstUnlisten).toHaveBeenCalledTimes(1);
    expect(secondUnlisten).not.toHaveBeenCalled();
  });

  it("queues dirty-file notifications instead of dropping earlier ones", () => {
    const { container, watcher } = createWatcher();
    const handleFileChanged = (watcher as unknown as { handleFileChanged: (path: string) => void })
      .handleFileChanged
      .bind(watcher as unknown as { handleFileChanged: (path: string) => void });

    handleFileChanged("a.md");
    handleFileChanged("b.md");

    expect(container.textContent).toContain("\"a.md\" changed externally. Reload?");

    const noButton = container.querySelector<HTMLButtonElement>(".file-watcher-btn-no");
    expect(noButton).not.toBeNull();
    noButton?.click();

    expect(container.textContent).toContain("\"b.md\" changed externally. Reload?");
  });

  it("suppresses duplicate notifications while a file is already pending", () => {
    const { container, watcher } = createWatcher();
    const handleFileChanged = (watcher as unknown as { handleFileChanged: (path: string) => void })
      .handleFileChanged
      .bind(watcher as unknown as { handleFileChanged: (path: string) => void });

    handleFileChanged("a.md");
    handleFileChanged("a.md");

    expect(container.querySelectorAll(".file-watcher-notification")).toHaveLength(1);
    expect(container.textContent?.match(/a\.md/g)?.length).toBe(1);
  });

  it("reloads the current file and advances to the next pending notification", async () => {
    const reloadFile = vi.fn(async () => {});
    const { container, watcher } = createWatcher(reloadFile);
    const handleFileChanged = (watcher as unknown as { handleFileChanged: (path: string) => void })
      .handleFileChanged
      .bind(watcher as unknown as { handleFileChanged: (path: string) => void });

    handleFileChanged("a.md");
    handleFileChanged("b.md");

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
    const { container, watcher } = createWatcher(reloadFile);
    const handleFileChanged = (watcher as unknown as { handleFileChanged: (path: string) => void })
      .handleFileChanged
      .bind(watcher as unknown as { handleFileChanged: (path: string) => void });

    handleFileChanged("a.md");
    handleFileChanged("b.md");

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
});
