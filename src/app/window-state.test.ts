import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WINDOW_STATE_KEY } from "../constants";
import {
  getWindowStateStorageKey,
  loadWindowState,
  saveWindowStateForLabel,
} from "./window-state";
import {
  createTestWindowState,
  DEFAULT_TEST_WINDOW_STATE,
} from "./window-state-test-fixtures";

const BASE_PATH = "/";

function persistRaw(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function setTauriWindowLabel(label: string): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      metadata: {
        currentWindow: { label },
      },
    },
  });
}

function clearTauriWindowLabel(): void {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  delete (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri;
}

describe("window-state launch params", () => {
  beforeEach(() => {
    localStorage.clear();
    clearTauriWindowLabel();
    window.history.replaceState({}, "", BASE_PATH);
  });

  afterEach(() => {
    localStorage.clear();
    clearTauriWindowLabel();
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
        createTestWindowState({
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
        createTestWindowState({
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

describe("window-state persisted schema", () => {
  beforeEach(() => {
    localStorage.clear();
    clearTauriWindowLabel();
    window.history.replaceState({}, "", BASE_PATH);
  });

  afterEach(() => {
    localStorage.clear();
    clearTauriWindowLabel();
    window.history.replaceState({}, "", BASE_PATH);
  });

  it("migrates legacy v1 tabs using the matching active tab", () => {
    persistRaw(WINDOW_STATE_KEY, {
      activeTab: "b.md",
      sidebarSections: [{ title: "Files", collapsed: true }],
      sidebarWidth: 320,
      tabs: [
        { path: "a.md", name: "A" },
        { path: "b.md", name: "B" },
      ],
      version: 1,
    });

    expect(loadWindowState()).toEqual({
      currentDocument: { path: "b.md", name: "B" },
      projectRoot: null,
      sidebarSections: [{ title: "Files", collapsed: true }],
      sidebarWidth: 320,
      version: 2,
    });
  });

  it("migrates legacy v1 tabs with stale or empty active-tab fallbacks", () => {
    persistRaw(WINDOW_STATE_KEY, {
      activeTab: "missing.md",
      sidebarSections: [],
      sidebarWidth: 260,
      tabs: [{ path: "first.md", name: "First" }],
      version: 1,
    });

    expect(loadWindowState().currentDocument).toEqual({
      path: "first.md",
      name: "First",
    });

    persistRaw(WINDOW_STATE_KEY, {
      activeTab: null,
      sidebarSections: [],
      sidebarWidth: 260,
      tabs: [],
      version: 1,
    });

    expect(loadWindowState().currentDocument).toBeNull();
  });

  it("rejects malformed persisted state and falls back to defaults", () => {
    localStorage.setItem(WINDOW_STATE_KEY, "{not json");
    expect(loadWindowState()).toEqual(DEFAULT_TEST_WINDOW_STATE);

    for (const malformed of [
      { version: 2, projectRoot: null, currentDocument: null, sidebarWidth: "220", sidebarSections: [] },
      { version: 2, projectRoot: null, currentDocument: { path: "a.md" }, sidebarWidth: 220, sidebarSections: [] },
      { version: 2, projectRoot: null, currentDocument: null, sidebarWidth: 220, sidebarSections: [{ title: "Files" }] },
      { version: 1, activeTab: null, sidebarWidth: 220, sidebarSections: [], tabs: "nope" },
      { version: 1, activeTab: null, sidebarWidth: 220, sidebarSections: [], tabs: [{ path: "a.md" }] },
      { version: 1, activeTab: null, sidebarWidth: 220, sidebarSections: [{ title: "Files" }], tabs: [] },
    ]) {
      persistRaw(WINDOW_STATE_KEY, malformed);
      expect(loadWindowState()).toEqual(DEFAULT_TEST_WINDOW_STATE);
    }
  });

  it("falls back from a missing scoped window key to the global state", () => {
    setTauriWindowLabel("document-a");
    persistRaw(WINDOW_STATE_KEY, createTestWindowState({
      currentDocument: { path: "global.md", name: "global.md" },
      projectRoot: "/project/global",
      sidebarSections: [],
      sidebarWidth: 300,
    }));

    expect(loadWindowState()).toMatchObject({
      currentDocument: { path: "global.md", name: "global.md" },
      projectRoot: "/project/global",
      sidebarWidth: 300,
    });
  });

  it("prefers scoped window state but falls back to global when scoped state is malformed", () => {
    setTauriWindowLabel("document-a");
    persistRaw(WINDOW_STATE_KEY, createTestWindowState({
      currentDocument: { path: "global.md", name: "global.md" },
      projectRoot: "/project/global",
      sidebarSections: [],
      sidebarWidth: 300,
    }));
    persistRaw(getWindowStateStorageKey("document-a"), createTestWindowState({
      currentDocument: { path: "scoped.md", name: "scoped.md" },
      projectRoot: "/project/scoped",
      sidebarSections: [],
      sidebarWidth: 420,
    }));

    expect(loadWindowState()).toMatchObject({
      currentDocument: { path: "scoped.md", name: "scoped.md" },
      projectRoot: "/project/scoped",
      sidebarWidth: 420,
    });

    localStorage.setItem(getWindowStateStorageKey("document-a"), "{bad json");

    expect(loadWindowState()).toMatchObject({
      currentDocument: { path: "global.md", name: "global.md" },
      projectRoot: "/project/global",
      sidebarWidth: 300,
    });
  });

  it("derives storage keys and saves snapshots for explicit window labels", () => {
    const state = createTestWindowState({
      currentDocument: { path: "notes.md", name: "notes.md" },
      projectRoot: "/project",
      sidebarSections: [{ title: "Files", collapsed: false }],
      sidebarWidth: 260,
    });

    expect(getWindowStateStorageKey(null)).toBe(WINDOW_STATE_KEY);
    expect(getWindowStateStorageKey("document-a")).toBe(`${WINDOW_STATE_KEY}:document-a`);

    saveWindowStateForLabel("document-a", state);
    expect(JSON.parse(localStorage.getItem(`${WINDOW_STATE_KEY}:document-a`) ?? "null"))
      .toEqual(state);

    saveWindowStateForLabel(null, state);
    expect(JSON.parse(localStorage.getItem(WINDOW_STATE_KEY) ?? "null")).toEqual(state);
  });
});
