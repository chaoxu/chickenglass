import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createActiveDocumentSignal } from "../active-document-signal";
import type { SaveActivityController } from "./use-save-activity";
import { useSaveActivity } from "./use-save-activity";

interface HarnessRef {
  result: SaveActivityController;
}

function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

describe("useSaveActivity", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("tracks in-flight save work and completed saves", async () => {
    const ref: HarnessRef = {
      result: null as unknown as SaveActivityController,
    };
    const activeDocumentSignal = createActiveDocumentSignal({
      scheduleNotify: (notify) => {
        notify();
        return () => {};
      },
    });
    const saveGate = createDeferred();
    const Harness: FC = () => {
      ref.result = useSaveActivity({
        activeDocumentSignal,
        currentPath: "notes.md",
      });
      return null;
    };

    act(() => root.render(createElement(Harness)));

    let savePromise!: Promise<void>;
    act(() => {
      savePromise = ref.result.trackSaveActivity(() => saveGate.promise);
    });

    expect(ref.result.saveActivity.status).toBe("saving");

    saveGate.resolve();
    await act(async () => {
      await savePromise;
    });

    expect(ref.result.saveActivity.status).toBe("idle");
  });

  it("keeps save failures visible until document activity clears them", async () => {
    const ref: HarnessRef = {
      result: null as unknown as SaveActivityController,
    };
    const activeDocumentSignal = createActiveDocumentSignal({
      scheduleNotify: (notify) => {
        notify();
        return () => {};
      },
    });
    const Harness: FC = () => {
      ref.result = useSaveActivity({
        activeDocumentSignal,
        currentPath: "notes.md",
      });
      return null;
    };

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await expect(
        ref.result.trackSaveActivity(
          async () => {
            throw new Error("disk full");
          },
        ),
      ).rejects.toThrow("disk full");
    });

    expect(ref.result.saveActivity).toEqual({
      status: "failed",
      message: "disk full",
    });

    act(() => {
      activeDocumentSignal.publish("notes.md");
    });

    expect(ref.result.saveActivity.status).toBe("idle");
  });
});
