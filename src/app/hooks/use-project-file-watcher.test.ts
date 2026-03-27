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
      onExternalChange?: (path: string) => void;
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

    constructor(config: { onExternalChange?: (path: string) => void }) {
      watcherMockState.instances.push({
        watch: this.watch,
        unwatch: this.unwatch,
        onExternalChange: config.onExternalChange,
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
  onExternalChange?: (path: string) => void;
}

const isPathOpen = () => true;
const isPathDirty = () => false;
const reloadFile = async () => {};

const Harness: FC<HarnessProps> = ({ projectRoot, onExternalChange }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useProjectFileWatcher({
    projectRoot,
    containerRef,
    isPathOpen,
    isPathDirty,
    reloadFile,
    onExternalChange,
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

  it("passes onExternalChange through to the file watcher", async () => {
    const onExternalChange = vi.fn();

    await act(async () => {
      root.render(createElement(Harness, {
        projectRoot: "/tmp/project-a",
        onExternalChange,
      }));
    });

    expect(watcherMockState.instances).toHaveLength(1);
    expect(watcherMockState.instances[0].onExternalChange).toBe(onExternalChange);
  });
});
