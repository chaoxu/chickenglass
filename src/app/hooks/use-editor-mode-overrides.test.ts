import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorMode } from "../../editor-display-mode";
import type { SearchNavigationTarget } from "../search";
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

  const getController = () => {
    if (!controller) {
      throw new Error("controller was not initialized");
    }
    return controller;
  };

  const render = (deps: Partial<EditorModeOverridesDeps> = {}) => {
    const mergedDeps: EditorModeOverridesDeps = {
      currentPath: "notes.md",
      defaultMode: "cm6-rich",
      handleSearchResultNavigation: vi.fn(async () => true),
      isMarkdownFile: true,
      runEditorTransaction: vi.fn((intent, body) => ({
        intent,
        value: body(),
      })),
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
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("commits a search-result mode override after navigation resolves", async () => {
    render();

    act(() => {
      getController().handleModeChange("source");
    });
    expect(getController().editorMode).toBe("source");

    await act(async () => {
      getController().handleSearchResult(target("cm6-rich"));
      await Promise.resolve();
    });

    expect(getController().editorMode).toBe("cm6-rich");
  });

  it("commits the search-result override eagerly so the next render sees it", () => {
    render();

    act(() => {
      getController().handleModeChange("source");
    });
    expect(getController().editorMode).toBe("source");

    act(() => {
      getController().handleSearchResult(target("cm6-rich"));
    });

    expect(getController().editorMode).toBe("cm6-rich");
  });

  it("uses the configured default mode when the active markdown file has no override", () => {
    render({ defaultMode: "source" });

    expect(getController().editorMode).toBe("source");
  });
});
