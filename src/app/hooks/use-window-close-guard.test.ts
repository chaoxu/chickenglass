import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const windowCloseGuardMockState = vi.hoisted(() => ({
  isTauri: false,
  destroy: vi.fn(async () => {}),
  closeRequestedHandler: null as null | ((event: { preventDefault: () => void }) => void | Promise<void>),
  onCloseRequested: vi.fn(async (
    handler: (event: { preventDefault: () => void }) => void | Promise<void>,
  ) => {
    windowCloseGuardMockState.closeRequestedHandler = handler;
    return () => {
      if (windowCloseGuardMockState.closeRequestedHandler === handler) {
        windowCloseGuardMockState.closeRequestedHandler = null;
      }
    };
  }),
  getCurrentWindow: vi.fn(() => ({
    onCloseRequested: windowCloseGuardMockState.onCloseRequested,
    destroy: windowCloseGuardMockState.destroy,
  })),
  reset() {
    this.isTauri = false;
    this.destroy.mockReset();
    this.destroy.mockImplementation(async () => {});
    this.closeRequestedHandler = null;
    this.onCloseRequested.mockReset();
    this.onCloseRequested.mockImplementation(async (
      handler: (event: { preventDefault: () => void }) => void | Promise<void>,
    ) => {
      windowCloseGuardMockState.closeRequestedHandler = handler;
      return () => {
        if (windowCloseGuardMockState.closeRequestedHandler === handler) {
          windowCloseGuardMockState.closeRequestedHandler = null;
        }
      };
    });
    this.getCurrentWindow.mockClear();
  },
}));

vi.mock("../../lib/tauri", () => ({
  isTauri: () => windowCloseGuardMockState.isTauri,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: windowCloseGuardMockState.getCurrentWindow,
}));

const { useWindowCloseGuard } = await import("./use-window-close-guard");

interface HarnessProps {
  hasDirtyDocument: boolean;
  handleWindowCloseRequest: () => Promise<boolean>;
}

function Harness({ hasDirtyDocument, handleWindowCloseRequest }: HarnessProps): null {
  useWindowCloseGuard({ hasDirtyDocument, handleWindowCloseRequest });
  return null;
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

describe("useWindowCloseGuard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    windowCloseGuardMockState.reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("registers a browser beforeunload prompt only when the current document is dirty", () => {
    const handleWindowCloseRequest = vi.fn(async () => true);

    act(() => {
      root.render(createElement(Harness, {
        hasDirtyDocument: false,
        handleWindowCloseRequest,
      }));
    });

    const cleanEvent = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(cleanEvent, "returnValue", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    act(() => {
      root.render(createElement(Harness, {
        hasDirtyDocument: true,
        handleWindowCloseRequest,
      }));
    });

    const dirtyEvent = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(dirtyEvent, "returnValue", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
    expect(dirtyEvent.returnValue).toBe("");
  });

  it("prevents Tauri close requests until the unsaved-changes flow allows closing", async () => {
    windowCloseGuardMockState.isTauri = true;
    const handleWindowCloseRequest = vi.fn(async () => true);

    await act(async () => {
      root.render(createElement(Harness, {
        hasDirtyDocument: true,
        handleWindowCloseRequest,
      }));
      await Promise.resolve();
    });

    const preventDefault = vi.fn();
    await act(async () => {
      await windowCloseGuardMockState.closeRequestedHandler?.({ preventDefault });
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(handleWindowCloseRequest).toHaveBeenCalledTimes(1);
    expect(windowCloseGuardMockState.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps the Tauri window open when the unsaved-changes flow cancels closing", async () => {
    windowCloseGuardMockState.isTauri = true;
    const handleWindowCloseRequest = vi.fn(async () => false);

    await act(async () => {
      root.render(createElement(Harness, {
        hasDirtyDocument: true,
        handleWindowCloseRequest,
      }));
      await Promise.resolve();
    });

    const preventDefault = vi.fn();
    await act(async () => {
      await windowCloseGuardMockState.closeRequestedHandler?.({ preventDefault });
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(handleWindowCloseRequest).toHaveBeenCalledTimes(1);
    expect(windowCloseGuardMockState.destroy).not.toHaveBeenCalled();
  });

  it("uses the latest Tauri close handler after rerender", async () => {
    windowCloseGuardMockState.isTauri = true;
    const staleHandler = vi.fn(async () => false);
    const latestHandler = vi.fn(async () => true);

    await act(async () => {
      root.render(createElement(Harness, {
        hasDirtyDocument: true,
        handleWindowCloseRequest: staleHandler,
      }));
      await Promise.resolve();
    });

    await act(async () => {
      root.render(createElement(Harness, {
        hasDirtyDocument: true,
        handleWindowCloseRequest: latestHandler,
      }));
      await Promise.resolve();
    });

    await act(async () => {
      await windowCloseGuardMockState.closeRequestedHandler?.({
        preventDefault: vi.fn(),
      });
    });

    expect(staleHandler).not.toHaveBeenCalled();
    expect(latestHandler).toHaveBeenCalledTimes(1);
    expect(windowCloseGuardMockState.destroy).toHaveBeenCalledTimes(1);
  });

  it("drops duplicate Tauri close requests while a confirmation is already in flight", async () => {
    windowCloseGuardMockState.isTauri = true;
    const deferred = createDeferred<boolean>();
    const handleWindowCloseRequest = vi.fn(() => deferred.promise);

    await act(async () => {
      root.render(createElement(Harness, {
        hasDirtyDocument: true,
        handleWindowCloseRequest,
      }));
      await Promise.resolve();
    });

    const firstPreventDefault = vi.fn();
    const secondPreventDefault = vi.fn();

    let firstClosePromise: Promise<void> | undefined;
    await act(async () => {
      firstClosePromise = Promise.resolve(
        windowCloseGuardMockState.closeRequestedHandler?.({ preventDefault: firstPreventDefault }),
      ).then(() => undefined);
      await Promise.resolve();
    });

    await act(async () => {
      await windowCloseGuardMockState.closeRequestedHandler?.({ preventDefault: secondPreventDefault });
    });

    expect(firstPreventDefault).toHaveBeenCalledTimes(1);
    expect(secondPreventDefault).toHaveBeenCalledTimes(1);
    expect(handleWindowCloseRequest).toHaveBeenCalledTimes(1);

    deferred.resolve(true);
    await act(async () => {
      await firstClosePromise;
    });

    expect(windowCloseGuardMockState.destroy).toHaveBeenCalledTimes(1);
  });

  it("unlistens a Tauri close listener that registers after unmount", async () => {
    windowCloseGuardMockState.isTauri = true;
    const registration = createDeferred<() => void>();
    const unlisten = vi.fn();
    windowCloseGuardMockState.onCloseRequested.mockImplementationOnce(async (
      handler: (event: { preventDefault: () => void }) => void | Promise<void>,
    ) => {
      windowCloseGuardMockState.closeRequestedHandler = handler;
      await registration.promise;
      return unlisten;
    });

    await act(async () => {
      root.render(createElement(Harness, {
        hasDirtyDocument: true,
        handleWindowCloseRequest: vi.fn(async () => true),
      }));
      await Promise.resolve();
    });

    act(() => {
      root.unmount();
    });

    await act(async () => {
      registration.resolve(unlisten);
      await registration.promise;
      await Promise.resolve();
    });

    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
