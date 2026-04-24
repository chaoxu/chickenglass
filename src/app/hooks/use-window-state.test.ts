import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { WINDOW_STATE_KEY } from "../../constants";
import { createTestWindowState } from "../window-state-test-fixtures";
import { useWindowState } from "./use-window-state";

describe("useWindowState", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("notifies every hook instance in the same tab", () => {
    const first = renderHook(() => useWindowState());
    const second = renderHook(() => useWindowState());

    act(() => {
      first.result.current.saveState({ projectRoot: "/tmp/project-a" });
    });

    expect(second.result.current.windowState.projectRoot).toBe("/tmp/project-a");
  });

  it("updates after browser storage events from another window", () => {
    const { result } = renderHook(() => useWindowState());
    const nextState = createTestWindowState({
      projectRoot: "/tmp/project-b",
      currentDocument: { path: "main.md", name: "main.md" },
    });

    act(() => {
      localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify(nextState));
      window.dispatchEvent(new StorageEvent("storage", {
        key: WINDOW_STATE_KEY,
        newValue: localStorage.getItem(WINDOW_STATE_KEY),
      }));
    });

    expect(result.current.windowState.projectRoot).toBe("/tmp/project-b");
    expect(result.current.windowState.currentDocument?.path).toBe("main.md");
  });
});
