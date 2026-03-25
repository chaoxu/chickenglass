import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockEditorView } from "../../test-utils";
import type { FileSystem } from "../file-manager";
import type { UseEditorDocumentServicesReturn } from "./use-editor-document-services";
import { programmaticDocumentChangeAnnotation } from "../../editor/programmatic-document-change";

const { useEditorDocumentServices } = await import("./use-editor-document-services");

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
    ref.result = useEditorDocumentServices({
      doc: "",
      fs,
      docPath,
    });
    return null;
  };

  return { Harness, ref };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function createFileSystem(reads: Record<string, Deferred<string>>): FileSystem {
  return {
    listTree: async () => ({ name: "root", path: "", isDirectory: true, children: [] }),
    readFile: (path: string) => {
      const deferred = reads[path];
      if (!deferred) {
        throw new Error(`unexpected read for ${path}`);
      }
      return deferred.promise;
    },
    writeFile: async () => {},
    createFile: async () => {},
    exists: async (path: string) => path in reads,
    renameFile: async () => {},
    createDirectory: async () => {},
    deleteFile: async () => {},
    writeFileBinary: async () => {},
    readFileBinary: async () => new Uint8Array(),
  };
}

describe("useEditorDocumentServices", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.__cfSourceMap = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.__cfSourceMap = null;
  });

  it("ignores stale include expansion results after the document context resets", async () => {
    const chapterRead = createDeferred<string>();
    const fs = createFileSystem({ "chapter.md": chapterRead });
    const { Harness, ref } = createHarness(fs);
    const dispatch = vi.fn();
    const view = createMockEditorView({
      dispatch,
      state: { doc: { toString: () => "", length: 0 } },
    });

    act(() => root.render(createElement(Harness)));

    ref.result.initializeView(view, undefined, [
      "::: {.include}",
      "chapter.md",
      ":::",
    ].join("\n"));
    ref.result.resetServices();
    ref.result.initializeView(view, undefined, "# Notes");

    await act(async () => {
      chapterRead.resolve("Expanded content");
      await chapterRead.promise;
      await Promise.resolve();
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(window.__cfSourceMap).toBeNull();
  });

  it("marks include expansion dispatches as programmatic document changes", async () => {
    const chapterRead = createDeferred<string>();
    const fs = createFileSystem({ "chapter.md": chapterRead });
    const { Harness, ref } = createHarness(fs);
    const dispatch = vi.fn();
    const view = createMockEditorView({
      dispatch,
      state: {
        doc: {
          toString: () => [
            "::: {.include}",
            "chapter.md",
            ":::",
          ].join("\n"),
          length: 28,
        },
      },
    });

    act(() => root.render(createElement(Harness)));

    ref.result.initializeView(view, undefined, [
      "::: {.include}",
      "chapter.md",
      ":::",
    ].join("\n"));

    await act(async () => {
      chapterRead.resolve("| A | B |\n| - | - |\n| 1 | 2 |");
      await chapterRead.promise;
      await Promise.resolve();
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].annotations?.type).toBe(
      programmaticDocumentChangeAnnotation,
    );
    expect(dispatch.mock.calls[0][0].annotations?.value).toBe(true);
  });
});
