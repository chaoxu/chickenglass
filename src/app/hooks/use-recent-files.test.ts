import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { RECENT_FILES_KEY, RECENT_FOLDERS_KEY } from "../../constants";
import { useRecentFiles } from "./use-recent-files";

describe("useRecentFiles", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("notifies every hook instance in the same tab", () => {
    const first = renderHook(() => useRecentFiles("/tmp/project"));
    const second = renderHook(() => useRecentFiles("/tmp/project"));

    act(() => {
      first.result.current.addRecentFile("main.md");
      first.result.current.addRecentFolder("/tmp/project");
    });

    expect(second.result.current.recentFiles).toEqual(["main.md"]);
    expect(second.result.current.recentFolders).toEqual(["/tmp/project"]);
  });

  it("updates after browser storage events from another window", () => {
    const { result } = renderHook(() => useRecentFiles("/tmp/project"));

    act(() => {
      localStorage.setItem(RECENT_FILES_KEY, JSON.stringify([
        { path: "draft.md", projectRoot: "/tmp/project" },
      ]));
      window.dispatchEvent(new StorageEvent("storage", {
        key: RECENT_FILES_KEY,
        newValue: localStorage.getItem(RECENT_FILES_KEY),
      }));
    });

    expect(result.current.recentFiles).toEqual(["draft.md"]);

    act(() => {
      localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(["/tmp/project"]));
      window.dispatchEvent(new StorageEvent("storage", {
        key: RECENT_FOLDERS_KEY,
        newValue: localStorage.getItem(RECENT_FOLDERS_KEY),
      }));
    });

    expect(result.current.recentFolders).toEqual(["/tmp/project"]);
  });
});
