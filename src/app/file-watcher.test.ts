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
    watchDirectoryCommand: vi.fn(async () => true),
    unwatchDirectoryCommand: vi.fn(async () => true),
    listen: vi.fn(async () => listenDeferred.promise),
    listenDeferred,
    reset() {
      this.watchDirectoryCommand.mockClear();
      this.watchDirectoryCommand.mockImplementation(async () => true);
      this.unwatchDirectoryCommand.mockClear();
      this.unwatchDirectoryCommand.mockImplementation(async () => true);
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
  options: {
    isFileOpen?: (path: string) => boolean;
    isFileDirty?: (path: string) => boolean;
    reloadFile?: (path: string) => Promise<void>;
    onExternalChange?: (path: string) => void;
  } = {},
) {
  const container = document.createElement("div");
  const {
    isFileOpen = () => true,
    isFileDirty = () => true,
    reloadFile = vi.fn(async (_path: string) => {}),
    onExternalChange,
  } = options;
  const watcher = new FileWatcher({
    isFileOpen,
    isFileDirty,
    reloadFile,
    onExternalChange,
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
      expect(watcherBackendState.watchDirectoryCommand).toHaveBeenCalledWith(
        "/tmp/project-a",
        expect.any(Number),
      );
    });

    await watcher.unwatch();
    expect(watcherBackendState.unwatchDirectoryCommand).toHaveBeenCalledTimes(1);
    expect(watcherBackendState.unwatchDirectoryCommand).toHaveBeenNthCalledWith(1, expect.any(Number));

    watcherBackendState.listenDeferred.resolve(unlisten);
    await watchPromise;

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(watcherBackendState.unwatchDirectoryCommand).toHaveBeenCalledTimes(2);
    expect(watcherBackendState.unwatchDirectoryCommand).toHaveBeenNthCalledWith(2, expect.any(Number));
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

    expect(secondUnlisten).not.toHaveBeenCalled();
    expect(watcherBackendState.watchDirectoryCommand).toHaveBeenNthCalledWith(
      1,
      "/tmp/project-a",
      expect.any(Number),
    );
    expect(watcherBackendState.watchDirectoryCommand).toHaveBeenNthCalledWith(
      2,
      "/tmp/project-a",
      expect.any(Number),
    );
    const [firstCall = [] as unknown[], secondCall = [] as unknown[]] =
      watcherBackendState.watchDirectoryCommand.mock.calls;
    const unwatchCalls = watcherBackendState.unwatchDirectoryCommand.mock.calls as Array<unknown[]>;
    const firstToken = firstCall[1];
    const secondToken = secondCall[1];
    expect(
      unwatchCalls.some((call) => call[0] === firstToken),
    ).toBe(true);
    expect(
      unwatchCalls.some((call) => call[0] === secondToken),
    ).toBe(false);
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
    const { container, watcher } = createWatcher({ reloadFile });
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
    const { container, watcher } = createWatcher({ reloadFile });
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

  it("invalidates cached assets even when the changed path is not an open document", () => {
    const onExternalChange = vi.fn();
    const { container, watcher } = createWatcher({
      isFileOpen: () => false,
      onExternalChange,
    });
    const handleFileChanged = (watcher as unknown as { handleFileChanged: (path: string) => void })
      .handleFileChanged
      .bind(watcher as unknown as { handleFileChanged: (path: string) => void });

    handleFileChanged("assets/diagram.png");

    expect(onExternalChange).toHaveBeenCalledWith("assets/diagram.png");
    expect(container.textContent).toBe("");
  });
});
