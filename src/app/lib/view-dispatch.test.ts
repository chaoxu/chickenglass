import { describe, expect, it, vi } from "vitest";
import { dispatchIfConnected } from "./view-dispatch";
import { createMockEditorView } from "../../test-utils";

describe("dispatchIfConnected", () => {
  it("dispatches when the view is still connected", () => {
    const dispatch = vi.fn();
    const view = createMockEditorView({ isConnected: true, dispatch });

    const result = dispatchIfConnected(view, { selection: { anchor: 0 } });

    expect(result).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("skips disconnected views without throwing", () => {
    const dispatch = vi.fn();
    const view = createMockEditorView({ isConnected: false, dispatch });

    const result = dispatchIfConnected(view, { selection: { anchor: 0 } });

    expect(result).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("logs and returns false when a connected view throws during dispatch", () => {
    const error = new Error("boom");
    const dispatch = vi.fn(() => {
      throw error;
    });
    const view = createMockEditorView({ isConnected: true, dispatch });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = dispatchIfConnected(view, { selection: { anchor: 0 } }, { context: "Dispatch failed:" });

    expect(result).toBe(false);
    expect(consoleError).toHaveBeenCalledWith("Dispatch failed:", error);

    consoleError.mockRestore();
  });
});
