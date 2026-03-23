import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileSystem } from "../file-manager";
import { MemoryFileSystem } from "../file-manager";
import type { UseEditorSessionReturn } from "./use-editor-session";

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

const { useEditorSession } = await import("./use-editor-session");

interface HarnessRef {
  result: UseEditorSessionReturn;
}

function createHarness(fs: FileSystem): { Harness: FC; ref: HarnessRef } {
  const ref: HarnessRef = {
    result: null as unknown as UseEditorSessionReturn,
  };

  const Harness: FC = () => {
    ref.result = useEditorSession({
      fs,
      refreshTree: async () => {},
      addRecentFile: () => {},
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

function createAsyncFileSystem(reads: Record<string, Deferred<string>>): FileSystem {
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
    exists: async () => false,
    renameFile: async () => {},
    createDirectory: async () => {},
    deleteFile: async () => {},
    writeFileBinary: async () => {},
  };
}

describe("useEditorSession", () => {
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

  it("does not replace editorDoc on the first clean-to-dirty transition", async () => {
    const fs = new MemoryFileSystem({ "draft.md": "hello" });
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));
    await act(async () => {
      await ref.result.openFile("draft.md");
    });

    expect(ref.result.editorDoc).toBe("hello");
    expect(ref.result.openTabs[0]?.dirty).toBe(false);

    act(() => {
      ref.result.handleDocChange("hello!");
    });

    expect(ref.result.editorDoc).toBe("hello");
    expect(ref.result.openTabs[0]?.dirty).toBe(true);
    expect(ref.result.liveDocs.current.get("draft.md")).toBe("hello!");
  });

  it("ignores stale openFile reads when a newer request wins", async () => {
    const reads = {
      "a.md": createDeferred<string>(),
      "b.md": createDeferred<string>(),
    };
    const fs = createAsyncFileSystem(reads);
    const { Harness, ref } = createHarness(fs);

    act(() => root.render(createElement(Harness)));

    let openA!: Promise<void>;
    let openB!: Promise<void>;
    await act(async () => {
      openA = ref.result.openFile("a.md", { preview: true });
      openB = ref.result.openFile("b.md", { preview: true });
      await Promise.resolve();
    });

    await act(async () => {
      reads["b.md"].resolve("B");
      await openB;
    });

    expect(ref.result.activeTab).toBe("b.md");
    expect(ref.result.openTabs.map((tab) => tab.path)).toEqual(["b.md"]);
    expect(ref.result.editorDoc).toBe("B");

    await act(async () => {
      reads["a.md"].resolve("A");
      await openA;
    });

    expect(ref.result.activeTab).toBe("b.md");
    expect(ref.result.openTabs.map((tab) => tab.path)).toEqual(["b.md"]);
    expect(ref.result.editorDoc).toBe("B");
  });
});
