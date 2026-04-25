import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveDocumentSignal } from "../active-document-signal";
import { createActiveDocumentSignal } from "../active-document-signal";
import { useAutoSave, type UseAutoSaveReturn } from "./use-auto-save";

interface HarnessProps {
  isDirty: boolean;
  onSave: () => Promise<void>;
  interval?: number;
  activeDocumentSignal?: ActiveDocumentSignal;
  currentPath?: string | null;
  onReady?: (controller: UseAutoSaveReturn) => void;
  suspended?: boolean;
}

const Harness: FC<HarnessProps> = ({
  isDirty,
  onSave,
  interval = 30_000,
  activeDocumentSignal,
  currentPath = "notes.md",
  onReady,
  suspended = false,
}) => {
  const controller = useAutoSave(isDirty, onSave, interval, suspended, {
    activeDocumentSignal,
    currentPath,
  });
  onReady?.(controller);
  return null;
};

describe("useAutoSave", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalHasFocus: typeof document.hasFocus;
  let hiddenState = false;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    hiddenState = false;
    originalHasFocus = document.hasFocus.bind(document);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hiddenState,
    });
    document.hasFocus = vi.fn(() => true);
    delete (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.hasFocus = originalHasFocus;
    delete (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri;
    vi.useRealTimers();
  });

  it("saves immediately on blur outside Tauri when autosave is enabled", async () => {
    const onSave = vi.fn(async () => {});

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onSave,
        interval: 30_000,
      }));
    });

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("does not save on browser lifecycle events when autosave is off", async () => {
    const onSave = vi.fn(async () => {});

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onSave,
        interval: 0,
      }));
    });

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("beforeunload"));
      hiddenState = true;
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it("debounces dirty edits until the configured idle delay", async () => {
    const onSave = vi.fn(async () => {});

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onSave,
        interval: 1_000,
      }));
    });

    await act(async () => {
      vi.advanceTimersByTime(999);
    });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("resets the idle debounce when the active document changes again", async () => {
    const onSave = vi.fn(async () => {});
    const activeDocumentSignal = createActiveDocumentSignal();

    act(() => {
      root.render(createElement(Harness, {
        activeDocumentSignal,
        isDirty: true,
        onSave,
        interval: 1_000,
      }));
    });

    await act(async () => {
      vi.advanceTimersByTime(700);
      activeDocumentSignal.publish("notes.md");
      vi.advanceTimersByTime(16);
      vi.advanceTimersByTime(299);
    });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(701);
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("flushes a pending debounce on page hide", async () => {
    const onSave = vi.fn(async () => {});

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onSave,
        interval: 30_000,
      }));
    });

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("logs auto-save failures", async () => {
    const error = new Error("disk full");
    const onSave = vi.fn(async () => { throw error; });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      act(() => {
        root.render(createElement(Harness, {
          isDirty: true,
          onSave,
          interval: 30_000,
        }));
      });

      await act(async () => {
        window.dispatchEvent(new Event("blur"));
      });

      expect(consoleError).toHaveBeenCalledWith("[auto-save] save failed", error);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("clears the in-flight guard after synchronous save failures", async () => {
    const error = new Error("sync save failure");
    const onSave = vi.fn(() => {
      throw error;
    }) as unknown as () => Promise<void>;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const flushAutoSave = async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    };

    try {
      act(() => {
        root.render(createElement(Harness, {
          isDirty: true,
          onSave,
          interval: 30_000,
        }));
      });

      await act(async () => {
        window.dispatchEvent(new Event("blur"));
        await flushAutoSave();
      });

      await act(async () => {
        window.dispatchEvent(new Event("blur"));
        await flushAutoSave();
      });

      expect(onSave).toHaveBeenCalledTimes(2);
      expect(consoleError).toHaveBeenCalledWith("[auto-save] save failed", error);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("awaits a queued forced flush requested while a save is in flight", async () => {
    let controller: UseAutoSaveReturn | null = null;
    const saveResolvers: Array<() => void> = [];
    const onSave = vi.fn(() => new Promise<void>((resolve) => {
      saveResolvers.push(resolve);
    }));

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onReady: (nextController) => {
          controller = nextController;
        },
        onSave,
        interval: 0,
      }));
    });
    const getController = () => {
      if (!controller) {
        throw new Error("Auto-save controller was not initialized");
      }
      return controller;
    };

    const firstFlush = getController().flushPendingAutoSave(
      "navigation",
      { force: true },
    );
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledTimes(1);

    let secondFlushResolved = false;
    const secondFlush = getController().flushPendingAutoSave(
      "shutdown",
      { force: true },
    ).then(() => {
      secondFlushResolved = true;
    });
    await Promise.resolve();
    expect(secondFlushResolved).toBe(false);
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      saveResolvers[0]?.();
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(secondFlushResolved).toBe(false);

    await act(async () => {
      saveResolvers[1]?.();
      await firstFlush;
      await secondFlush;
    });

    expect(secondFlushResolved).toBe(true);
  });

  it("delays Tauri blur saves so a suspended close flow can cancel them", async () => {
    const onSave = vi.fn(async () => {});
    (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri = true;
    document.hasFocus = vi.fn(() => false);

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onSave,
        interval: 30_000,
        suspended: false,
      }));
    });

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(100);
    });

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onSave,
        interval: 30_000,
        suspended: true,
      }));
    });

    await act(async () => {
      vi.runAllTimers();
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it("invalidates a pending Tauri blur save when an unsaved-changes flow opens and resolves quickly", async () => {
    const onSave = vi.fn(async () => {});
    (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri = true;
    document.hasFocus = vi.fn(() => false);

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onSave,
        interval: 30_000,
      }));
    });

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(100);
    });

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onSave,
        interval: 30_000,
        suspended: true,
      }));
    });

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onSave,
        interval: 30_000,
        suspended: false,
      }));
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it("invalidates a pending Tauri hidden-window save when an unsaved-changes flow opens and resolves quickly", async () => {
    const onSave = vi.fn(async () => {});
    (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri = true;
    hiddenState = true;

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onSave,
        interval: 30_000,
      }));
    });

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(100);
    });

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onSave,
        interval: 30_000,
        suspended: true,
      }));
    });

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onSave,
        interval: 30_000,
        suspended: false,
      }));
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it("still saves after the Tauri delay when the window remains unfocused", async () => {
    const onSave = vi.fn(async () => {});
    (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri = true;
    document.hasFocus = vi.fn(() => false);

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onSave,
        interval: 30_000,
      }));
    });

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(300);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
