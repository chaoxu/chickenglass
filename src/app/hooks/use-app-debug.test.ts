import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LexicalEditor } from "lexical";
import type { EditorMode } from "../editor-mode";
import { SourceMap } from "../source-map";

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

const openProject = vi.fn(async (_path: string) => true);
const openFile = vi.fn(async (_path: string) => {});
const hasFile = vi.fn(async (_path: string) => true);
const openFileWithContent = vi.fn(async (_name: string, _content: string) => {});
const saveFile = vi.fn(async () => {});
const closeFile = vi.fn(async (_options?: { discard?: boolean }) => true);
const setSearchOpen = vi.fn((_open: boolean) => {});
const requestNativeClose = vi.fn(async () => {});
const setMode = vi.fn((_mode: EditorMode) => {});
const getMode = vi.fn(() => "lexical" as const);
const getCurrentSourceMap = vi.fn(() => new SourceMap([]));
const editorHandle = {
  focus: vi.fn(),
  getDoc: vi.fn(() => "# Notes"),
  getSelection: vi.fn(() => ({ anchor: 0, focus: 0, from: 0, to: 0 })),
  insertText: vi.fn(),
  setDoc: vi.fn(),
  setSelection: vi.fn(),
  applyChanges: vi.fn(),
};

const Harness: FC = () => {
  useAppDebug({
    editorHandle,
    lexicalEditor: null,
    openProject,
    openFile,
    hasFile,
    openFileWithContent,
    saveFile,
    closeFile,
    setSearchOpen,
    requestNativeClose,
    setMode,
    getMode,
    getCurrentDocText: () => "# Notes",
    getCurrentSourceMap,
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
    setSearchOpen.mockClear();
    requestNativeClose.mockClear();
    setMode.mockClear();
    getMode.mockClear();
    getMode.mockReturnValue("lexical");
    getCurrentSourceMap.mockClear();
    getCurrentSourceMap.mockReturnValue(new SourceMap([]));
    editorHandle.focus.mockClear();
    editorHandle.getDoc.mockClear();
    editorHandle.getSelection.mockClear();
    editorHandle.insertText.mockClear();
    editorHandle.setDoc.mockClear();
    editorHandle.setSelection.mockClear();
    editorHandle.applyChanges.mockClear();
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
    expect(window.__editor?.getDoc).toBeDefined();
    expect(window.__cmView?.state.doc.toString()).toBe("# Notes");
    expect(typeof window.__cmDebug?.treeString()).toBe("string");
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
      mode: "lexical",
      backendProjectRoot: "/tmp/backend-project",
      backendProjectGeneration: 4,
      watcherRoot: "/tmp/backend-project",
      watcherGeneration: 7,
      watcherActive: true,
      lastFocusedWindow: "main",
    });

    await window.__tauriSmoke?.simulateExternalChange("notes.md", true);
    expect(nativeDebugMockState.debugEmitFileChanged).toHaveBeenCalledWith("notes.md", true);

    await expect(window.__tauriSmoke?.listWindows()).resolves.toEqual([
      { label: "main", focused: true },
    ]);
  });
});
