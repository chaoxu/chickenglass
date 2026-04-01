import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryFileSystem } from "../file-manager";
import type { Settings } from "../lib/types";
import type { AppEditorShellController } from "./use-app-editor-shell";

vi.mock("../perf", () => ({
  measureAsync: (_name: string, task: () => Promise<unknown>) => task(),
  withPerfOperation: async (
    _name: string,
    task: (operation: {
      id: string;
      name: string;
      measureAsync: <T>(spanName: string, spanTask: () => Promise<T>) => Promise<T>;
      measureSync: <T>(spanName: string, spanTask: () => T) => T;
      end: () => void;
    }) => Promise<unknown>,
  ) => task({
    id: "test-operation",
    name: "test-operation",
    measureAsync: async (_spanName, spanTask) => spanTask(),
    measureSync: (_spanName, spanTask) => spanTask(),
    end: () => {},
  }),
}));

const { useAppEditorShell } = await import("./use-app-editor-shell");

interface HarnessRef {
  result: AppEditorShellController;
}

interface HarnessOptions {
  files?: Record<string, string>;
  requestUnsavedChangesDecision?: () => Promise<"save" | "discard" | "cancel">;
}

function createHarness(
  options: HarnessOptions = {},
): { Harness: FC; ref: HarnessRef } {
  const ref: HarnessRef = {
    result: null as unknown as AppEditorShellController,
  };

  const settings: Settings = {
    autoSaveInterval: 30000,
    fontSize: 16,
    lineHeight: 1.6,
    tabSize: 2,
    showLineNumbers: false,
    wordWrap: true,
    spellCheck: false,
    editorMode: "rich",
    theme: "system",
    defaultExportFormat: "pdf",
    enabledPlugins: {},
    themeName: "default",
    writingTheme: "academic",
    customCss: "",
    skipDirtyConfirm: true,
  };

  const fs = new MemoryFileSystem(options.files ?? {});

  const Harness: FC = () => {
    ref.result = useAppEditorShell({
      fs,
      settings,
      refreshTree: async () => {},
      addRecentFile: () => {},
      requestUnsavedChangesDecision:
        options.requestUnsavedChangesDecision ?? (async () => "discard"),
    });
    return null;
  };

  return { Harness, ref };
}

describe("useAppEditorShell", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("delegates navigation handlers from useEditorNavigation", () => {
    const { Harness, ref } = createHarness();

    act(() => root.render(createElement(Harness)));

    expect(ref.result.handleOutlineSelect).toBeTypeOf("function");
    expect(ref.result.handleGotoLine).toBeTypeOf("function");
    expect(ref.result.handleSearchResult).toBeTypeOf("function");
    expect(ref.result.handleEditorDocumentReady).toBeTypeOf("function");
  });

  it("preserves the current file mode when search navigation fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { Harness, ref } = createHarness({
      files: {
        "notes.md": "# Notes\n",
      },
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("notes.md");
    });

    act(() => {
      ref.result.handleModeChange("source");
    });

    expect(ref.result.editorMode).toBe("source");

    act(() => {
      ref.result.handleSearchResult({
        file: "missing.md",
        pos: 0,
        editorMode: "source",
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(ref.result.currentPath).toBe("notes.md");
    expect(ref.result.editorMode).toBe("source");

    errorSpy.mockRestore();
  });

  it("applies the requested mode after cross-file search navigation opens the target", async () => {
    const { Harness, ref } = createHarness({
      files: {
        "a.md": "# A\n",
        "b.md": "# B\n",
      },
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("a.md");
    });

    act(() => {
      ref.result.handleSearchResult({
        file: "b.md",
        pos: 0,
        editorMode: "source",
      });
    });

    await vi.waitFor(() => {
      expect(ref.result.currentPath).toBe("b.md");
      expect(ref.result.editorMode).toBe("source");
    });
  });

  it("does not persist a target mode override when search navigation is canceled", async () => {
    const requestUnsavedChangesDecision = vi
      .fn<() => Promise<"save" | "discard" | "cancel">>()
      .mockResolvedValue("discard");
    const { Harness, ref } = createHarness({
      files: {
        "a.md": "# A\n",
        "b.md": "# B\n",
      },
      requestUnsavedChangesDecision,
    });

    act(() => root.render(createElement(Harness)));

    await act(async () => {
      await ref.result.openFile("a.md");
    });

    act(() => {
      ref.result.handleModeChange("source");
      ref.result.handleDocChange("# A changed\n");
    });

    requestUnsavedChangesDecision.mockResolvedValueOnce("cancel");

    act(() => {
      ref.result.handleSearchResult({
        file: "b.md",
        pos: 0,
        editorMode: "source",
      });
    });

    await vi.waitFor(() => {
      expect(ref.result.currentPath).toBe("a.md");
      expect(ref.result.editorMode).toBe("source");
    });

    requestUnsavedChangesDecision.mockResolvedValueOnce("discard");

    await act(async () => {
      await ref.result.openFile("b.md");
    });

    expect(ref.result.currentPath).toBe("b.md");
    expect(ref.result.editorMode).toBe("rich");
  });
});
