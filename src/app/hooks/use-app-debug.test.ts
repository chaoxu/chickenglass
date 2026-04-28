import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarkdownEditorHandle } from "../../lexical/markdown-editor-types";

const nativeDebugMockState = vi.hoisted(() => ({
  debugListWindows: vi.fn(async () => [{ label: "main", focused: true }]),
  debugGetNativeState: vi.fn(async () => ({
    project_root: "/tmp/backend-project",
    project_generation: 4,
    watcher_root: "/tmp/backend-project",
    watcher_generation: 7,
    watcher_active: true,
    watcher_health: {
      status: "healthy",
      generation: 7,
      root: "/tmp/backend-project",
      message: "Native watcher is active",
    },
    last_focused_window: "main",
  })),
  debugEmitFileChanged: vi.fn(async (_relativePath: string, _treeChanged?: boolean) => {}),
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
const { DEBUG_BRIDGE_REQUIRED_GLOBAL_NAMES } = await import("../../debug/debug-bridge-contract.js");

const openProject = vi.fn(async (_path: string) => true);
const openFile = vi.fn(async (_path: string) => {});
const hasFile = vi.fn(async (_path: string) => true);
const openFileWithContent = vi.fn(async (_name: string, _content: string) => {});
const saveFile = vi.fn(async () => {});
const closeFile = vi.fn(async (_options?: { discard?: boolean }) => true);
const getCurrentDocText = vi.fn(() => "# Notes");
const getLexicalEditorHandle = vi.fn<() => MarkdownEditorHandle | null>(() => null);
const setSearchOpen = vi.fn((_open: boolean) => {});
const showSidebarPanel = vi.fn((_panel: string) => {});
const getSidebarState = vi.fn(() => ({ collapsed: false, tab: "files" as const }));
const requestNativeClose = vi.fn(async () => {});
const setMode = vi.fn((_mode: string) => {});
const getMode = vi.fn(() => "cm6-rich" as const);

const Harness: FC = () => {
  useAppDebug({
    openProject,
    openFile,
    hasFile,
    openFileWithContent,
    saveFile,
    closeFile,
    getCurrentDocText,
    getLexicalEditorHandle,
    setSearchOpen,
    showSidebarPanel,
    getSidebarState,
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
    hasFile.mockClear();
    openFileWithContent.mockClear();
    saveFile.mockClear();
    closeFile.mockClear();
    getCurrentDocText.mockClear();
    getCurrentDocText.mockReturnValue("# Notes");
    getLexicalEditorHandle.mockClear();
    getLexicalEditorHandle.mockReturnValue(null);
    setSearchOpen.mockClear();
    showSidebarPanel.mockClear();
    getSidebarState.mockClear();
    getSidebarState.mockReturnValue({ collapsed: false, tab: "files" });
    requestNativeClose.mockClear();
    setMode.mockClear();
    getMode.mockClear();
    getMode.mockReturnValue("cm6-rich");
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

    expect(window.__app?.openFileWithContent).toBeDefined();
    await expect(window.__app?.ready).resolves.toBeUndefined();
    await expect(window.__editor?.ready).resolves.toBeUndefined();
    await expect(window.__cfDebug?.ready).resolves.toBeUndefined();
    expect(
      DEBUG_BRIDGE_REQUIRED_GLOBAL_NAMES.every((name) => Boolean(window[name])),
    ).toBe(true);
    expect(window.__editor?.getDoc()).toBe("# Notes");
    expect(window.__cfDebug?.interactionLog).toBeDefined();
    expect(window.__cfDebug?.exportSession()).toMatchObject({
      currentDocument: "# Notes",
    });
    await expect(window.__cfDebug?.captureFullSession()).resolves.toMatchObject({
      session: {
        currentDocument: "# Notes",
      },
      interactions: [],
    });
    await expect(window.__cfDebug?.clearAllDebugBuffers()).resolves.toBeUndefined();
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
      mode: "cm6-rich",
      backendProjectRoot: "/tmp/backend-project",
      backendProjectGeneration: 4,
      watcherRoot: "/tmp/backend-project",
      watcherGeneration: 7,
      watcherActive: true,
      watcherHealth: {
        status: "healthy",
        generation: 7,
        root: "/tmp/backend-project",
        message: "Native watcher is active",
      },
      frontendWatcherStatus: expect.objectContaining({
        status: "stopped",
        generation: null,
        root: null,
      }),
      lastFocusedWindow: "main",
    });

    await window.__tauriSmoke?.simulateExternalChange("notes.md", true);
    expect(nativeDebugMockState.debugEmitFileChanged).toHaveBeenCalledWith("notes.md", true);

    await expect(window.__tauriSmoke?.listWindows()).resolves.toEqual([
      { label: "main", focused: true },
    ]);
  });

  it("formats Lexical debug selections against the live editor document", async () => {
    const handle: MarkdownEditorHandle = {
      applyChanges: vi.fn(),
      flushPendingEdits: vi.fn(() => null),
      focus: vi.fn(),
      getDoc: vi.fn(() => "Alpha live omega"),
      getSelection: vi.fn(() => ({
        anchor: 6,
        focus: 10,
        from: 6,
        to: 10,
      })),
      insertText: vi.fn(),
      peekDoc: vi.fn(() => "Alpha live omega"),
      peekSelection: vi.fn(() => ({
        anchor: 6,
        focus: 10,
        from: 6,
        to: 10,
      })),
      setDoc: vi.fn(),
      setSelection: vi.fn(),
    };
    getCurrentDocText.mockReturnValue("Alpha stale omega");
    getLexicalEditorHandle.mockReturnValue(handle);

    act(() => {
      root.render(createElement(Harness));
    });

    expect(window.__editor?.formatSelection({ type: "bold" })).toBe(true);
    expect(handle.applyChanges).toHaveBeenCalledWith([{
      from: 6,
      to: 10,
      insert: "**live**",
    }]);
    expect(handle.setSelection).toHaveBeenCalledWith(8, 12);
    expect(handle.focus).toHaveBeenCalled();
  });
});
