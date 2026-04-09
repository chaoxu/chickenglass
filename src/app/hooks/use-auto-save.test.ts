import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoSave } from "./use-auto-save";

interface HarnessProps {
  isDirty: boolean;
  onSave: () => Promise<void>;
  interval?: number;
  suspended?: boolean;
  suspensionVersion?: number;
}

const Harness: FC<HarnessProps> = ({
  isDirty,
  onSave,
  interval = 30_000,
  suspended = false,
  suspensionVersion = 0,
}) => {
  useAutoSave(isDirty, onSave, interval, suspended, suspensionVersion);
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

  it("saves immediately on blur outside Tauri", async () => {
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
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("delays Tauri blur saves so a suspended close flow can cancel them", async () => {
    const onSave = vi.fn(async () => {});
    (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri = true;
    document.hasFocus = vi.fn(() => false);

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onSave,
        interval: 0,
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
        interval: 0,
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
        interval: 0,
        suspensionVersion: 0,
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
        interval: 0,
        suspended: true,
        suspensionVersion: 1,
      }));
    });

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onSave,
        interval: 0,
        suspended: false,
        suspensionVersion: 2,
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
        interval: 0,
        suspensionVersion: 0,
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
        interval: 0,
        suspended: true,
        suspensionVersion: 1,
      }));
    });

    act(() => {
      root.render(createElement(Harness, {
        isDirty: true,
        onSave,
        interval: 0,
        suspended: false,
        suspensionVersion: 2,
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
        interval: 0,
      }));
    });

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(300);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
