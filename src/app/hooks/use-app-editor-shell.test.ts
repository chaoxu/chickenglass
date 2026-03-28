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

function createHarness(): { Harness: FC; ref: HarnessRef } {
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

  const fs = new MemoryFileSystem({});

  const Harness: FC = () => {
    ref.result = useAppEditorShell({
      fs,
      settings,
      refreshTree: async () => {},
      refreshGitStatus: async () => {},
      addRecentFile: () => {},
      requestUnsavedChangesDecision: async () => "discard",
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
});
