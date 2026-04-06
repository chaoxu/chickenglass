/**
 * Integration test: include expansion cache survives document switches.
 *
 * Uses vi.mock to spy on resolveIncludesFromContent — the resolver is only
 * called on a cache miss. On a cache hit the entire resolve + flatten pipeline
 * is skipped, so the spy call count proves the cache was used.
 */
import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockEditorView } from "../../test-utils";
import type { FileSystem } from "../file-manager";
import type { UseEditorDocumentServicesReturn } from "./use-editor-document-services";

// Spy on resolveIncludesFromContent — only invoked on a cache miss.
vi.mock("../../plugins", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../plugins")>();
  return {
    ...actual,
    resolveIncludesFromContent: vi.fn().mockImplementation(
      actual.resolveIncludesFromContent,
    ),
  };
});

const plugins = await import("../../plugins");
const resolveSpy = vi.mocked(plugins.resolveIncludesFromContent);

const { useEditorDocumentServices } = await import(
  "./use-editor-document-services"
);

interface HarnessRef {
  result: UseEditorDocumentServicesReturn;
}

function createHarness(
  fs: FileSystem,
  docPath = "main.md",
): { Harness: FC; ref: HarnessRef } {
  const ref: HarnessRef = {
    result: null as unknown as UseEditorDocumentServicesReturn,
  };
  const Harness: FC = () => {
    ref.result = useEditorDocumentServices({ doc: "", fs, docPath });
    return null;
  };
  return { Harness, ref };
}

function createSimpleFs(files: Record<string, string>): FileSystem {
  return {
    listTree: async () => ({
      name: "root",
      path: "",
      isDirectory: true,
      children: [],
    }),
    readFile: async (path: string) => {
      if (path in files) return files[path];
      throw new Error(`file not found: ${path}`);
    },
    writeFile: async () => {},
    createFile: async () => {},
    exists: async (path: string) => path in files,
    renameFile: async () => {},
    createDirectory: async () => {},
    deleteFile: async () => {},
    writeFileBinary: async () => {},
    readFileBinary: async () => new Uint8Array(),
  };
}

describe("include expansion cache integration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.__cfSourceMap = null;
    resolveSpy.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.__cfSourceMap = null;
    vi.useRealTimers();
  });

  it("reuses cached expansion after resetServices (document switch)", async () => {
    const fs = createSimpleFs({ "chapter.md": "# Chapter 1\nContent here." });
    const { Harness, ref } = createHarness(fs);
    const dispatch = vi.fn();
    const docContent = "::: {.include}\nchapter.md\n:::";
    const view = createMockEditorView({
      dispatch,
      state: {
        doc: { toString: () => docContent, length: docContent.length },
      },
    });

    act(() => root.render(createElement(Harness)));

    // First open — cache miss, resolveIncludesFromContent is called.
    ref.result.initializeView(view, undefined, docContent);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);

    // Simulate document switch (as useEditor does).
    resolveSpy.mockClear();
    dispatch.mockClear();
    ref.result.resetServices();

    // Reopen same document — cache hit, resolver NOT called.
    ref.result.initializeView(view, undefined, docContent);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("invalidates cache when an included file changes between opens", async () => {
    const files: Record<string, string> = {
      "chapter.md": "# Chapter 1\nOriginal.",
    };
    const fs = createSimpleFs(files);
    const { Harness, ref } = createHarness(fs);
    const dispatch = vi.fn();
    const docContent = "::: {.include}\nchapter.md\n:::";
    const view = createMockEditorView({
      dispatch,
      state: {
        doc: { toString: () => docContent, length: docContent.length },
      },
    });

    act(() => root.render(createElement(Harness)));

    // First open — populates cache.
    ref.result.initializeView(view, undefined, docContent);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(resolveSpy).toHaveBeenCalledTimes(1);

    // Modify the included file on disk.
    files["chapter.md"] = "# Chapter 1\nRevised.";
    resolveSpy.mockClear();
    dispatch.mockClear();
    ref.result.resetServices();

    // Reopen — cache validation fails, resolver called again.
    ref.result.initializeView(view, undefined, docContent);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
