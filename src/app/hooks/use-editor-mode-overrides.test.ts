import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorMode } from "../../editor-display-mode";
import type { SearchNavigationTarget } from "../search";
import type { PendingLexicalNavigation } from "./use-editor-surface-handles";
import {
  useEditorModeOverrides,
  type EditorModeOverridesController,
  type EditorModeOverridesDeps,
} from "./use-editor-mode-overrides";

interface HarnessProps {
  deps: EditorModeOverridesDeps;
  onReady: (controller: EditorModeOverridesController) => void;
}

const Harness: FC<HarnessProps> = ({ deps, onReady }) => {
  const controller = useEditorModeOverrides(deps);
  onReady(controller);
  return null;
};

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

function target(editorMode: EditorMode): SearchNavigationTarget {
  return {
    editorMode,
    file: "notes.md",
    pos: 1,
  };
}

describe("useEditorModeOverrides", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: EditorModeOverridesController | null;
  let queuedNavigation: PendingLexicalNavigation | null;

  const getController = () => {
    if (!controller) {
      throw new Error("controller was not initialized");
    }
    return controller;
  };

  const render = (deps: Partial<EditorModeOverridesDeps> = {}) => {
    const mergedDeps: EditorModeOverridesDeps = {
      clearPendingLexicalNavigation: vi.fn(),
      currentPath: "notes.md",
      defaultMode: "cm6-rich",
      editorDoc: "",
      getSessionCurrentDocText: () => "",
      handleSearchResultNavigation: vi.fn(async () => true),
      isMarkdownFile: true,
      isPathOpen: () => true,
      openFile: vi.fn(async () => {}),
      queueLexicalNavigation: (navigation) => {
        queuedNavigation = navigation;
      },
      runEditorTransaction: vi.fn((intent, body) => ({
        flush: { shouldDeferModeSwitch: false },
        intent,
        value: body(),
      })),
      sessionHandleDocumentSnapshot: vi.fn(),
      ...deps,
    };

    act(() => {
      root.render(createElement(Harness, {
        deps: mergedDeps,
        onReady: (nextController) => {
          controller = nextController;
        },
      }));
    });
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    controller = null;
    queuedNavigation = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("lets a pending search mode override a committed mode for the active path", async () => {
    render();

    act(() => {
      getController().handleModeChange("source");
    });
    expect(getController().editorMode).toBe("source");

    await act(async () => {
      getController().handleSearchResult(target("lexical"));
      await Promise.resolve();
    });

    expect(getController().editorMode).toBe("lexical");
    expect(queuedNavigation?.path).toBe("notes.md");
  });

  it("ignores a stale search completion after a newer pending request starts", async () => {
    const firstNavigation = createDeferred<boolean>();
    const handleSearchResultNavigation = vi.fn(() => firstNavigation.promise);
    render({ handleSearchResultNavigation });

    act(() => {
      getController().handleSearchResult(target("source"));
    });
    expect(getController().editorMode).toBe("source");

    await act(async () => {
      getController().handleSearchResult(target("lexical"));
      await Promise.resolve();
    });
    expect(getController().editorMode).toBe("lexical");

    await act(async () => {
      firstNavigation.resolve(true);
      await firstNavigation.promise;
      await Promise.resolve();
    });

    expect(getController().editorMode).toBe("lexical");
  });

  it("uses the configured default mode when the active markdown file has no override", () => {
    render({ defaultMode: "lexical" });

    expect(getController().editorMode).toBe("lexical");
  });
});
