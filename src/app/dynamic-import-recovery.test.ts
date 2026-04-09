import { describe, expect, it, vi } from "vitest";

import {
  clearDynamicImportRecoveryFlag,
  installDynamicImportRecovery,
  isDynamicImportFailure,
} from "./dynamic-import-recovery";

describe("dynamic import recovery", () => {
  it("detects common dynamic import fetch failures", () => {
    expect(
      isDynamicImportFailure(new TypeError("Failed to fetch dynamically imported module")),
    ).toBe(true);
    expect(
      isDynamicImportFailure({ message: "Importing a module script failed" }),
    ).toBe(true);
    expect(isDynamicImportFailure(new Error("ordinary failure"))).toBe(false);
  });

  it("reloads once for matching error and unhandledrejection events", () => {
    const reload = vi.fn();
    const storage = new Map<string, string>();
    const target = new EventTarget();

    const cleanup = installDynamicImportRecovery({
      reload,
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value);
        },
      },
      target: target as unknown as Window,
    });

    const errorEvent = new ErrorEvent("error", {
      message: "Failed to fetch dynamically imported module",
    });
    target.dispatchEvent(errorEvent);
    target.dispatchEvent(errorEvent);

    const rejectionEvent = new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason: new TypeError("Failed to fetch dynamically imported module"),
    });
    target.dispatchEvent(rejectionEvent);

    expect(reload).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("clears the recovery flag", () => {
    const removed: string[] = [];
    clearDynamicImportRecoveryFlag({
      removeItem(key) {
        removed.push(key);
      },
    });
    expect(removed).toEqual(["coflat.dynamic-import-recovery"]);
  });
});
