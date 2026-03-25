import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WINDOW_STATE_KEY } from "../constants";
import { buildWindowState, loadWindowState } from "./window-state";

const BASE_PATH = "/";
const storage = new Map<string, string>();
const storageMock = {
  getItem(key: string): string | null {
    return storage.has(key) ? storage.get(key)! : null;
  },
  setItem(key: string, value: string): void {
    storage.set(key, value);
  },
  removeItem(key: string): void {
    storage.delete(key);
  },
};

function resetWindowStateStorage(): void {
  storage.clear();
  storage.delete(WINDOW_STATE_KEY);
}

describe("window-state launch params", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storageMock,
    });
    resetWindowStateStorage();
    window.history.replaceState({}, "", BASE_PATH);
  });

  afterEach(() => {
    resetWindowStateStorage();
    window.history.replaceState({}, "", BASE_PATH);
  });

  it("consumes startup project/file params once and strips them from the URL", () => {
    window.history.replaceState(
      {},
      "",
      `/?projectRoot=${encodeURIComponent("/tmp/coflat-native-project-a")}&file=${encodeURIComponent("b.md")}&keep=1#section`,
    );

    const state = loadWindowState();

    expect(state.projectRoot).toBe("/tmp/coflat-native-project-a");
    expect(state.currentDocument).toEqual({
      path: "b.md",
      name: "b.md",
    });
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/?keep=1#section",
    );
  });

  it("lets launch params override the persisted root/document while keeping other window state", () => {
    localStorage.setItem(
      WINDOW_STATE_KEY,
      JSON.stringify(
        buildWindowState({
          currentDocument: { path: "notes.md", name: "notes.md" },
          projectRoot: "/tmp/original-project",
          sidebarWidth: 312,
          sidebarSections: [{ title: "Files", collapsed: true }],
        }),
      ),
    );
    window.history.replaceState(
      {},
      "",
      `/?projectRoot=${encodeURIComponent("/tmp/coflat-native-project-b")}&file=${encodeURIComponent("outside.md")}`,
    );

    const state = loadWindowState();

    expect(state.projectRoot).toBe("/tmp/coflat-native-project-b");
    expect(state.currentDocument).toEqual({
      path: "outside.md",
      name: "outside.md",
    });
    expect(state.sidebarWidth).toBe(312);
    expect(state.sidebarSections).toEqual([{ title: "Files", collapsed: true }]);
  });

  it("clears the persisted document when launch params switch to a different root without a file", () => {
    localStorage.setItem(
      WINDOW_STATE_KEY,
      JSON.stringify(
        buildWindowState({
          currentDocument: { path: "notes.md", name: "notes.md" },
          projectRoot: "/tmp/original-project",
          sidebarWidth: 220,
          sidebarSections: [],
        }),
      ),
    );
    window.history.replaceState(
      {},
      "",
      `/?projectRoot=${encodeURIComponent("/tmp/coflat-native-project-b")}`,
    );

    const state = loadWindowState();

    expect(state.projectRoot).toBe("/tmp/coflat-native-project-b");
    expect(state.currentDocument).toBeNull();
  });
});
