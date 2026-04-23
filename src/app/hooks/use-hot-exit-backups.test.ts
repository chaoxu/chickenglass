import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActiveDocumentSignal, type ActiveDocumentSignal } from "../active-document-signal";
import type { HotExitBackupStore } from "../hot-exit-backups";
import type { SessionDocument } from "../editor-session-model";
import { useHotExitBackups, type UseHotExitBackupsReturn } from "./use-hot-exit-backups";

interface HarnessProps {
  activeDocumentSignal: ActiveDocumentSignal;
  currentDocument: SessionDocument | null;
  delayMs?: number;
  getCurrentBaselineHash?: () => string | null;
  getCurrentDocText: () => string;
  onReady?: (controller: UseHotExitBackupsReturn) => void;
  projectRoot: string | null;
  store?: HotExitBackupStore | null;
}

const Harness: FC<HarnessProps> = ({
  activeDocumentSignal,
  currentDocument,
  delayMs = 1_000,
  getCurrentBaselineHash,
  getCurrentDocText,
  onReady,
  projectRoot,
  store,
}) => {
  const controller = useHotExitBackups({
    activeDocumentSignal,
    currentDocument,
    delayMs,
    getCurrentBaselineHash,
    getCurrentDocText,
    projectRoot,
    store,
  });
  onReady?.(controller);
  return null;
};

function createStore(): HotExitBackupStore {
  return {
    writeBackup: vi.fn(async () => ({
      bytes: 100,
      contentHash: "hash",
      id: "id",
      name: "main.md",
      path: "main.md",
      projectKey: "project",
      projectRoot: "/project",
      updatedAt: 1,
    })),
    listBackups: vi.fn(async () => []),
    readBackup: vi.fn(async () => null),
    deleteBackup: vi.fn(async () => {}),
  };
}

function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe("useHotExitBackups", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("debounces dirty document backups and reads content only when the timer fires", async () => {
    const activeDocumentSignal = createActiveDocumentSignal();
    const store = createStore();
    const getCurrentDocText = vi.fn(() => "draft");

    act(() => {
      root.render(createElement(Harness, {
        activeDocumentSignal,
        currentDocument: { dirty: true, name: "main.md", path: "main.md" },
        getCurrentBaselineHash: () => "baseline",
        getCurrentDocText,
        projectRoot: "/project",
        store,
      }));
    });

    await act(async () => {
      vi.advanceTimersByTime(999);
      await Promise.resolve();
    });
    expect(store.writeBackup).not.toHaveBeenCalled();
    expect(getCurrentDocText).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getCurrentDocText).toHaveBeenCalledTimes(1);
    expect(store.writeBackup).toHaveBeenCalledWith({
      baselineHash: "baseline",
      content: "draft",
      name: "main.md",
      path: "main.md",
      projectRoot: "/project",
    });
  });

  it("reschedules on active document edits while already dirty", async () => {
    const activeDocumentSignal = createActiveDocumentSignal();
    const store = createStore();
    let content = "first";

    act(() => {
      root.render(createElement(Harness, {
        activeDocumentSignal,
        currentDocument: { dirty: true, name: "main.md", path: "main.md" },
        getCurrentDocText: () => content,
        projectRoot: "/project",
        store,
      }));
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
      content = "second";
      activeDocumentSignal.publish("main.md");
      vi.advanceTimersByTime(16);
      vi.advanceTimersByTime(900);
      await Promise.resolve();
    });
    expect(store.writeBackup).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store.writeBackup).toHaveBeenCalledWith({
      content: "second",
      name: "main.md",
      path: "main.md",
      projectRoot: "/project",
    });
  });

  it("does not write backups when clean, missing a project, or disabled", async () => {
    const activeDocumentSignal = createActiveDocumentSignal();
    const store = createStore();
    const cleanDocument = { dirty: false, name: "main.md", path: "main.md" };

    act(() => {
      root.render(createElement(Harness, {
        activeDocumentSignal,
        currentDocument: cleanDocument,
        getCurrentDocText: () => "draft",
        projectRoot: "/project",
        store,
      }));
    });

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
    expect(store.writeBackup).not.toHaveBeenCalled();

    act(() => {
      root.render(createElement(Harness, {
        activeDocumentSignal,
        currentDocument: { dirty: true, name: "main.md", path: "main.md" },
        getCurrentDocText: () => "draft",
        projectRoot: null,
        store,
      }));
    });

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
    expect(store.writeBackup).not.toHaveBeenCalled();

    act(() => {
      root.render(createElement(Harness, {
        activeDocumentSignal,
        currentDocument: { dirty: true, name: "main.md", path: "main.md" },
        getCurrentDocText: () => "draft",
        projectRoot: "/project",
        store: null,
      }));
    });

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
    expect(store.writeBackup).not.toHaveBeenCalled();
  });

  it("skips duplicate content writes until the backup is deleted", async () => {
    const activeDocumentSignal = createActiveDocumentSignal();
    const store = createStore();
    let controller: UseHotExitBackupsReturn | null = null;

    act(() => {
      root.render(createElement(Harness, {
        activeDocumentSignal,
        currentDocument: { dirty: true, name: "main.md", path: "main.md" },
        getCurrentDocText: () => "same",
        onReady: (nextController) => {
          controller = nextController;
        },
        projectRoot: "/project",
        store,
      }));
    });

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
      activeDocumentSignal.publish("main.md");
      vi.advanceTimersByTime(16);
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(store.writeBackup).toHaveBeenCalledTimes(1);

    act(() => {
      controller?.deleteBackup("main.md");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(store.deleteBackup).toHaveBeenCalledWith("/project", "main.md");

    await act(async () => {
      activeDocumentSignal.publish("main.md");
      vi.advanceTimersByTime(16);
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(store.writeBackup).toHaveBeenCalledTimes(2);
  });

  it("flushes a pending backup immediately", async () => {
    const activeDocumentSignal = createActiveDocumentSignal();
    const store = createStore();
    const getCurrentDocText = vi.fn(() => "draft");
    let controller: UseHotExitBackupsReturn | null = null;

    act(() => {
      root.render(createElement(Harness, {
        activeDocumentSignal,
        currentDocument: { dirty: true, name: "main.md", path: "main.md" },
        delayMs: 10_000,
        getCurrentDocText,
        onReady: (nextController) => {
          controller = nextController;
        },
        projectRoot: "/project",
        store,
      }));
    });

    await act(async () => {
      await controller?.flushBackup();
      await Promise.resolve();
    });

    expect(getCurrentDocText).toHaveBeenCalledTimes(1);
    expect(store.writeBackup).toHaveBeenCalledTimes(1);
  });

  it("deletes a stale backup when a save races with an in-flight write", async () => {
    const activeDocumentSignal = createActiveDocumentSignal();
    const writeGate = createDeferred<void>();
    const writeStarted = createDeferred<void>();
    const store = createStore();
    vi.mocked(store.writeBackup).mockImplementation(async () => {
      writeStarted.resolve();
      await writeGate.promise;
      return {
        bytes: 100,
        contentHash: "hash",
        id: "id",
        name: "main.md",
        path: "main.md",
        projectKey: "project",
        projectRoot: "/project",
        updatedAt: 1,
      };
    });
    let controller: UseHotExitBackupsReturn | null = null;

    act(() => {
      root.render(createElement(Harness, {
        activeDocumentSignal,
        currentDocument: { dirty: true, name: "main.md", path: "main.md" },
        getCurrentDocText: () => "draft",
        onReady: (nextController) => {
          controller = nextController;
        },
        projectRoot: "/project",
        store,
      }));
    });

    let flushPromise!: Promise<void>;
    await act(async () => {
      flushPromise = controller?.flushBackup() ?? Promise.resolve();
      await writeStarted.promise;
    });

    act(() => {
      controller?.deleteBackup("main.md");
    });

    await act(async () => {
      writeGate.resolve();
      await flushPromise;
      await Promise.resolve();
    });

    expect(store.writeBackup).toHaveBeenCalledTimes(1);
    expect(store.deleteBackup).toHaveBeenCalledWith("/project", "main.md");
    expect(store.deleteBackup).toHaveBeenCalledTimes(1);
  });
});
