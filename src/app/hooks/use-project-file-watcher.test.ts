import { act, createElement, useRef, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const watcherMockState = vi.hoisted(() => {
  interface Deferred {
    promise: Promise<void>;
    resolve: () => void;
  }

  const createDeferred = (): Deferred => {
    let resolve!: () => void;
    const promise = new Promise<void>((innerResolve) => {
      resolve = innerResolve;
    });
    return { promise, resolve };
  };

  return {
    instances: [] as Array<{
      watch: ReturnType<typeof vi.fn>;
      unwatch: ReturnType<typeof vi.fn>;
    }>,
    pendingWatch: false,
    deferred: createDeferred(),
    reset() {
      this.instances.length = 0;
      this.pendingWatch = false;
      this.deferred = createDeferred();
    },
  };
});

vi.mock("../file-watcher", () => ({
  FileWatcher: class MockFileWatcher {
    watch = vi.fn(async () => {
      if (watcherMockState.pendingWatch) {
        await watcherMockState.deferred.promise;
      }
    });

    unwatch = vi.fn(async () => {});

    constructor() {
      watcherMockState.instances.push({
        watch: this.watch,
        unwatch: this.unwatch,
      });
    }
  },
}));

vi.mock("../../lib/tauri", () => ({
  isTauri: () => true,
}));

const { useProjectFileWatcher } = await import("./use-project-file-watcher");

interface HarnessProps {
  projectRoot: string | null;
  refreshTree?: (changedPath?: string) => Promise<void>;
  reloadFile?: (path: string) => Promise<void>;
  syncExternalChange?: (path: string) => Promise<"ignore">;
}

const defaultRefreshTree = async () => {};
const defaultReloadFile = async () => {};
const defaultSyncExternalChange = async () => "ignore" as const;

const Harness: FC<HarnessProps> = ({
  projectRoot,
  refreshTree = defaultRefreshTree,
  reloadFile = defaultReloadFile,
  syncExternalChange = defaultSyncExternalChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useProjectFileWatcher({
    projectRoot,
    containerRef,
    refreshTree,
    reloadFile,
    syncExternalChange,
  });
  return createElement("div", { ref: containerRef });
};

describe("useProjectFileWatcher", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    watcherMockState.reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("tears down a watcher that finishes starting after cleanup", async () => {
    watcherMockState.pendingWatch = true;

    await act(async () => {
      root.render(createElement(Harness, { projectRoot: "/tmp/project-a" }));
    });

    expect(watcherMockState.instances).toHaveLength(1);
    const [instance] = watcherMockState.instances;
    expect(instance.watch).toHaveBeenCalledWith("/tmp/project-a");

    act(() => {
      root.unmount();
    });

    expect(instance.unwatch).toHaveBeenCalledTimes(1);

    await act(async () => {
      watcherMockState.deferred.resolve();
      await watcherMockState.deferred.promise;
    });

    expect(instance.unwatch).toHaveBeenCalledTimes(2);
  });

  it("does not let a stale startup stop a newer watcher", async () => {
    watcherMockState.pendingWatch = true;

    await act(async () => {
      root.render(createElement(Harness, { projectRoot: "/tmp/project-a" }));
    });

    expect(watcherMockState.instances).toHaveLength(1);
    const firstInstance = watcherMockState.instances[0];

    act(() => {
      root.unmount();
    });

    root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness, { projectRoot: "/tmp/project-a" }));
    });

    expect(watcherMockState.instances).toHaveLength(2);
    const secondInstance = watcherMockState.instances[1];

    await act(async () => {
      watcherMockState.deferred.resolve();
      await watcherMockState.deferred.promise;
    });

    expect(firstInstance.unwatch).toHaveBeenCalledTimes(2);
    expect(secondInstance.unwatch).not.toHaveBeenCalled();
  });

  it("moves the watcher when the project root changes", async () => {
    await act(async () => {
      root.render(createElement(Harness, { projectRoot: "/tmp/project-a" }));
    });

    expect(watcherMockState.instances).toHaveLength(1);
    const firstInstance = watcherMockState.instances[0];

    await act(async () => {
      root.render(createElement(Harness, { projectRoot: "/tmp/project-b" }));
    });

    expect(firstInstance.unwatch).toHaveBeenCalledTimes(1);
    expect(watcherMockState.instances).toHaveLength(2);
    expect(watcherMockState.instances[1].watch).toHaveBeenCalledWith("/tmp/project-b");
  });

  it("keeps the watcher mounted when callback identities change", async () => {
    const firstRefreshTree = vi.fn(async () => {});
    const secondRefreshTree = vi.fn(async () => {});

    await act(async () => {
      root.render(createElement(Harness, {
        projectRoot: "/tmp/project-a",
        refreshTree: firstRefreshTree,
      }));
    });

    expect(watcherMockState.instances).toHaveLength(1);
    const [instance] = watcherMockState.instances;

    await act(async () => {
      root.render(createElement(Harness, {
        projectRoot: "/tmp/project-a",
        refreshTree: secondRefreshTree,
      }));
    });

    expect(watcherMockState.instances).toHaveLength(1);
    expect(instance.unwatch).not.toHaveBeenCalled();
  });
});
