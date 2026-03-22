import { describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import { dispatchIfConnected } from "./view-dispatch";

function makeView(isConnected: boolean, dispatchImpl?: () => void): EditorView {
  return {
    dom: { isConnected } as HTMLElement,
    dispatch: dispatchImpl ?? vi.fn(),
  } as unknown as EditorView;
}

describe("dispatchIfConnected", () => {
  it("dispatches when the view is still connected", () => {
    const dispatch = vi.fn();
    const view = makeView(true, dispatch);

    const result = dispatchIfConnected(view, { selection: { anchor: 0 } });

    expect(result).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("skips disconnected views without throwing", () => {
    const dispatch = vi.fn();
    const view = makeView(false, dispatch);

    const result = dispatchIfConnected(view, { selection: { anchor: 0 } });

    expect(result).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("logs and returns false when a connected view throws during dispatch", () => {
    const error = new Error("boom");
    const dispatch = vi.fn(() => {
      throw error;
    });
    const view = makeView(true, dispatch);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = dispatchIfConnected(view, { selection: { anchor: 0 } }, { context: "Dispatch failed:" });

    expect(result).toBe(false);
    expect(consoleError).toHaveBeenCalledWith("Dispatch failed:", error);

    consoleError.mockRestore();
  });
});
