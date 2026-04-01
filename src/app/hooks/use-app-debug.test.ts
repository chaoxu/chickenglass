import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativeDebugMockState = vi.hoisted(() => ({
  debugListWindows: vi.fn(async () => [{ label: "main", focused: true }]),
  debugGetNativeState: vi.fn(async () => ({
    project_root: "/tmp/backend-project",
    project_generation: 4,
    watcher_root: "/tmp/backend-project",
    watcher_generation: 7,
    watcher_active: true,
    last_focused_window: "main",
  })),
  debugEmitFileChanged: vi.fn(async (_relativePath: string) => {}),
  reset() {
    this.debugListWindows.mockClear();
    this.debugGetNativeState.mockClear();
    this.debugEmitFileChanged.mockClear();
  },
}));

vi.mock("../../lib/tauri", () => ({
  isTauri: () => true,
}));

vi.mock("../tauri-client/debug", () => ({
  debugListWindowsCommand: nativeDebugMockState.debugListWindows,
  debugGetNativeStateCommand: nativeDebugMockState.debugGetNativeState,
  debugEmitFileChangedCommand: nativeDebugMockState.debugEmitFileChanged,
}));

const { useAppDebug } = await import("./use-app-debug");

const openProject = vi.fn(async (_path: string) => true);
const openFile = vi.fn(async (_path: string) => {});
const saveFile = vi.fn(async () => {});
const closeFile = vi.fn(() => {});
const setSearchOpen = vi.fn((_open: boolean) => {});
const requestNativeClose = vi.fn(async () => {});
const setMode = vi.fn((_mode: "rich" | "source" | "read") => {});
const getMode = vi.fn(() => "rich" as const);

const Harness: FC = () => {
  useAppDebug({
    openProject,
    openFile,
    saveFile,
    closeFile,
    setSearchOpen,
    requestNativeClose,
    setMode,
    getMode,
    projectRoot: "/tmp/frontend-project",
    currentDocument: {
      path: "notes.md",
      name: "notes.md",
      dirty: true,
    },
    hasDirtyDocument: true,
    startupComplete: true,
    restoredProjectRoot: "/tmp/saved-project",
  });
  return null;
};

describe("useAppDebug", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    nativeDebugMockState.reset();
    openProject.mockClear();
    openFile.mockClear();
    saveFile.mockClear();
    closeFile.mockClear();
    setSearchOpen.mockClear();
    requestNativeClose.mockClear();
    setMode.mockClear();
    getMode.mockClear();
    getMode.mockReturnValue("rich");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("exposes a tauri smoke bridge with frontend and backend state", async () => {
    act(() => {
      root.render(createElement(Harness));
    });

    expect(window.__tauriSmoke).toBeDefined();

    const snapshot = await window.__tauriSmoke?.getWindowState();

    expect(snapshot).toEqual({
      projectRoot: "/tmp/frontend-project",
      currentDocument: {
        path: "notes.md",
        name: "notes.md",
        dirty: true,
      },
      dirty: true,
      startupComplete: true,
      restoredProjectRoot: "/tmp/saved-project",
      mode: "rich",
      backendProjectRoot: "/tmp/backend-project",
      backendProjectGeneration: 4,
      watcherRoot: "/tmp/backend-project",
      watcherGeneration: 7,
      watcherActive: true,
      lastFocusedWindow: "main",
    });

    await window.__tauriSmoke?.simulateExternalChange("notes.md");
    expect(nativeDebugMockState.debugEmitFileChanged).toHaveBeenCalledWith("notes.md");

    await expect(window.__tauriSmoke?.listWindows()).resolves.toEqual([
      { label: "main", focused: true },
    ]);
  });
});
