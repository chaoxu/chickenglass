import { act, createElement, useRef, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UseEditorReturn } from "./use-editor";
import { programmaticDocumentChangeAnnotation } from "../../editor/programmatic-document-change";

const { useEditor } = await import("./use-editor");

interface HarnessRef {
  state: UseEditorReturn;
}

interface HarnessProps {
  doc: string;
  docPath: string;
  onDocChange?: (doc: string) => void;
}

function createHarness(ref: HarnessRef): FC<HarnessProps> {
  return function Harness(props: HarnessProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    ref.state = useEditor(containerRef, props);
    return createElement("div", { ref: containerRef });
  };
}

describe("useEditor", () => {
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

  it("keeps the same EditorView instance when switching documents", () => {
    const ref: HarnessRef = {
      state: null as unknown as UseEditorReturn,
    };
    const Harness = createHarness(ref);

    act(() => {
      root.render(createElement(Harness, {
        doc: "# First",
        docPath: "first.md",
      }));
    });

    const firstView = ref.state.view;
    expect(firstView).not.toBeNull();
    expect(firstView?.state.doc.toString()).toBe("# First");

    act(() => {
      root.render(createElement(Harness, {
        doc: "# Second",
        docPath: "second.md",
      }));
    });

    expect(ref.state.view).toBe(firstView);
    expect(ref.state.view?.state.doc.toString()).toBe("# Second");
  });

  it("replaces the document when switching away from protected table and fence content", () => {
    const ref: HarnessRef = {
      state: null as unknown as UseEditorReturn,
    };
    const Harness = createHarness(ref);
    const firstDoc = [
      "::: {.theorem}",
      "A fenced block.",
      ":::",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
    ].join("\n");
    const secondDoc = [
      "# Research Notes",
      "",
      "- Derandomize Karger",
      "- Tighten runtime bound",
    ].join("\n");

    act(() => {
      root.render(createElement(Harness, {
        doc: firstDoc,
        docPath: "main.md",
      }));
    });

    const firstView = ref.state.view;
    expect(firstView?.state.doc.toString()).toBe(firstDoc);

    act(() => {
      root.render(createElement(Harness, {
        doc: secondDoc,
        docPath: "notes.md",
      }));
    });

    expect(ref.state.view).toBe(firstView);
    expect(ref.state.view?.state.doc.toString()).toBe(secondDoc);
  });

  it("does not report annotated programmatic document replacements as user edits", () => {
    const ref: HarnessRef = {
      state: null as unknown as UseEditorReturn,
    };
    const Harness = createHarness(ref);
    const onDocChange = vi.fn();

    act(() => {
      root.render(createElement(Harness, {
        doc: "# First",
        docPath: "first.md",
        onDocChange,
      }));
    });

    onDocChange.mockClear();

    act(() => {
      ref.state.view?.dispatch({
        changes: { from: 0, to: ref.state.view.state.doc.length, insert: "# Second" },
        annotations: programmaticDocumentChangeAnnotation.of(true),
      });
    });

    expect(ref.state.view?.state.doc.toString()).toBe("# Second");
    expect(onDocChange).not.toHaveBeenCalled();
  });
});
