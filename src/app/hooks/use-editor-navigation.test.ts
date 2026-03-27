import { act, createElement, useState, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useEditorNavigation,
  type EditorNavigationController,
  type EditorNavigationDeps,
} from "./use-editor-navigation";

interface HarnessRef {
  result: EditorNavigationController;
  setCurrentPath: (path: string | null) => void;
  setIsPathOpen: (fn: (path: string) => boolean) => void;
}

function createFakeView(): {
  view: EditorView;
  dispatch: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
} {
  const dispatch = vi.fn();
  const focus = vi.fn();
  return {
    view: { dispatch, focus } as unknown as EditorView,
    dispatch,
    focus,
  };
}

function createFakeViewWithDoc(lines: string[]): {
  view: EditorView;
  dispatch: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
} {
  const dispatch = vi.fn();
  const focus = vi.fn();
  let offset = 0;
  const lineInfo = lines.map((line, i) => {
    const from = offset;
    offset += line.length + 1; // +1 for newline
    return { from, to: from + line.length, number: i + 1, text: line };
  });
  return {
    view: {
      dispatch,
      focus,
      state: {
        doc: {
          lines: lines.length,
          line: (n: number) => lineInfo[n - 1],
        },
      },
    } as unknown as EditorView,
    dispatch,
    focus,
  };
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

function createHarness(overrides?: Partial<EditorNavigationDeps>): {
  Harness: FC;
  ref: HarnessRef;
} {
  const ref: HarnessRef = {
    result: null as unknown as EditorNavigationController,
    setCurrentPath: null as unknown as (path: string | null) => void,
    setIsPathOpen: null as unknown as (fn: (path: string) => boolean) => void,
  };

  const Harness: FC = () => {
    const [currentPath, setCurrentPath] = useState<string | null>(null);
    const [isPathOpen, setIsPathOpen] = useState<(path: string) => boolean>(
      () => overrides?.isPathOpen ?? (() => true),
    );
    ref.setCurrentPath = setCurrentPath;
    ref.setIsPathOpen = (fn) => setIsPathOpen(() => fn);
    ref.result = useEditorNavigation({
      openFile: overrides?.openFile ?? (async () => {}),
      isPathOpen,
      currentPath,
      ...overrides,
    });
    return null;
  };

  return { Harness, ref };
}

describe("useEditorNavigation", () => {
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

  describe("handleOutlineSelect", () => {
    it("dispatches selection and focuses the view", () => {
      const { Harness, ref } = createHarness();
      const fakeView = createFakeView();

      act(() => root.render(createElement(Harness)));
      act(() => ref.result.syncView(fakeView.view));
      act(() => ref.result.handleOutlineSelect(42));

      expect(fakeView.dispatch).toHaveBeenCalledWith({
        selection: { anchor: 42 },
        scrollIntoView: true,
      });
      expect(fakeView.focus).toHaveBeenCalledOnce();
    });

    it("does nothing when no view is available", () => {
      const { Harness, ref } = createHarness();

      act(() => root.render(createElement(Harness)));
      // No syncView call — view is null
      expect(() => {
        act(() => ref.result.handleOutlineSelect(42));
      }).not.toThrow();
    });
  });

  describe("handleGotoLine", () => {
    it("dispatches to correct offset for line and column", () => {
      const { Harness, ref } = createHarness();
      // Lines: "hello\nworld\nfoo" → line 2 starts at offset 6
      const fakeView = createFakeViewWithDoc(["hello", "world", "foo"]);

      act(() => root.render(createElement(Harness)));
      act(() => ref.result.syncView(fakeView.view));
      act(() => ref.result.handleGotoLine(2, 3));

      expect(fakeView.dispatch).toHaveBeenCalledWith({
        selection: { anchor: 8 }, // line 2 from=6, col 3 → 6 + 2 = 8
        scrollIntoView: true,
      });
      expect(fakeView.focus).toHaveBeenCalledOnce();
    });

    it("clamps line numbers to document range", () => {
      const { Harness, ref } = createHarness();
      const fakeView = createFakeViewWithDoc(["only-line"]);

      act(() => root.render(createElement(Harness)));
      act(() => ref.result.syncView(fakeView.view));
      act(() => ref.result.handleGotoLine(999));

      // Clamped to line 1 (the only line), from=0
      expect(fakeView.dispatch).toHaveBeenCalledWith({
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
    });
  });

  describe("handleSearchResult", () => {
    it("waits for editor-ready signal before navigating", async () => {
      const openFile = vi.fn().mockResolvedValue(undefined);
      const { Harness, ref } = createHarness({ openFile });
      const onComplete = vi.fn();
      const fakeView = createFakeView();

      act(() => root.render(createElement(Harness)));

      // Simulate the file being open at session level
      await act(async () => {
        ref.result.handleSearchResult("notes.md", 4, onComplete);
        await Promise.resolve();
        await Promise.resolve();
      });

      // Navigation should not have happened yet — waiting for editor ready
      expect(fakeView.dispatch).not.toHaveBeenCalled();
      expect(onComplete).not.toHaveBeenCalled();

      // Signal readiness
      await act(async () => {
        ref.result.handleEditorDocumentReady(fakeView.view, "notes.md");
        await Promise.resolve();
      });

      expect(fakeView.dispatch).toHaveBeenCalledWith({
        selection: { anchor: 4 },
        scrollIntoView: true,
      });
      expect(fakeView.focus).toHaveBeenCalledOnce();
      expect(onComplete).toHaveBeenCalledOnce();
    });

    it("skips stale navigation when a newer request wins", async () => {
      const deferredA = createDeferred<undefined>();
      const deferredB = createDeferred<undefined>();
      const openFile = vi.fn().mockImplementation((path: string) => {
        if (path === "a.md") return deferredA.promise;
        if (path === "b.md") return deferredB.promise;
        return Promise.resolve();
      });
      const { Harness, ref } = createHarness({ openFile });
      const onCompleteA = vi.fn();
      const onCompleteB = vi.fn();
      const viewB = createFakeView();

      act(() => root.render(createElement(Harness)));

      await act(async () => {
        ref.result.handleSearchResult("a.md", 1, onCompleteA);
        ref.result.handleSearchResult("b.md", 2, onCompleteB);
        await Promise.resolve();
      });

      // Resolve b.md first
      await act(async () => {
        deferredB.resolve(undefined);
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        ref.result.handleEditorDocumentReady(viewB.view, "b.md");
        await Promise.resolve();
      });

      expect(viewB.dispatch).toHaveBeenCalledWith({
        selection: { anchor: 2 },
        scrollIntoView: true,
      });
      expect(onCompleteB).toHaveBeenCalledOnce();

      // Now resolve a.md — should be treated as stale
      await act(async () => {
        deferredA.resolve(undefined);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onCompleteA).toHaveBeenCalledOnce();
    });

    it("aborts pending wait when currentPath changes", async () => {
      const openFile = vi.fn().mockResolvedValue(undefined);
      const { Harness, ref } = createHarness({ openFile });
      const onComplete = vi.fn();
      const staleView = createFakeView();

      act(() => root.render(createElement(Harness)));

      await act(async () => {
        ref.result.handleSearchResult("a.md", 1, onComplete);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onComplete).not.toHaveBeenCalled();

      // Simulate switching to a different file externally
      await act(async () => {
        ref.setCurrentPath("b.md");
      });

      // The waiter for a.md should have been aborted
      expect(onComplete).toHaveBeenCalledOnce();

      // Late ready signal for a.md should have no effect
      await act(async () => {
        ref.result.handleEditorDocumentReady(staleView.view, "a.md");
        await Promise.resolve();
      });

      expect(staleView.dispatch).not.toHaveBeenCalled();
    });

    it("navigates immediately when document is already ready", async () => {
      const openFile = vi.fn().mockResolvedValue(undefined);
      const { Harness, ref } = createHarness({ openFile });
      const onComplete = vi.fn();
      const fakeView = createFakeView();

      act(() => root.render(createElement(Harness)));

      // Pre-signal readiness
      act(() => ref.result.handleEditorDocumentReady(fakeView.view, "notes.md"));

      await act(async () => {
        ref.result.handleSearchResult("notes.md", 10, onComplete);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fakeView.dispatch).toHaveBeenCalledWith({
        selection: { anchor: 10 },
        scrollIntoView: true,
      });
      expect(onComplete).toHaveBeenCalledOnce();
    });

    it("calls onComplete even when file is not open", async () => {
      const openFile = vi.fn().mockResolvedValue(undefined);
      const isPathOpen = vi.fn().mockReturnValue(false);
      const { Harness, ref } = createHarness({ openFile, isPathOpen });
      const onComplete = vi.fn();

      act(() => root.render(createElement(Harness)));

      await act(async () => {
        ref.result.handleSearchResult("missing.md", 0, onComplete);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onComplete).toHaveBeenCalledOnce();
    });
  });

  describe("syncView", () => {
    it("aborts pending readiness waiters when view goes null", async () => {
      const openFile = vi.fn().mockResolvedValue(undefined);
      const { Harness, ref } = createHarness({ openFile });
      const onComplete = vi.fn();

      act(() => root.render(createElement(Harness)));

      await act(async () => {
        ref.result.handleSearchResult("a.md", 1, onComplete);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onComplete).not.toHaveBeenCalled();

      // View goes null (e.g. editor unmounts)
      await act(async () => {
        ref.result.syncView(null);
        await Promise.resolve();
      });

      // Waiter should be aborted
      expect(onComplete).toHaveBeenCalledOnce();
    });
  });
});
