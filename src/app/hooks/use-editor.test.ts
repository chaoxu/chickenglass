import { act, createElement, useRef, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileSystem } from "../file-manager";
import { MemoryFileSystem } from "../file-manager";
import type { EditorDocumentChange } from "../editor-doc-change";
import type { UseEditorReturn } from "./use-editor";
import { programmaticDocumentChangeAnnotation } from "../../editor/programmatic-document-change";
import type { SourceMap } from "../source-map";

const { useEditor } = await import("./use-editor");

interface HarnessRef {
  state: UseEditorReturn;
}

interface HarnessProps {
  doc: string;
  docPath: string;
  fs?: FileSystem;
  onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  onProgrammaticDocChange?: (doc: string) => void;
  onSourceMapChange?: (sourceMap: SourceMap | null) => void;
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

  it("does not replay a stale external doc prop after a user edit rerender", () => {
    const ref: HarnessRef = {
      state: null as unknown as UseEditorReturn,
    };
    const Harness = createHarness(ref);

    act(() => {
      root.render(createElement(Harness, {
        doc: "hello",
        docPath: "draft.md",
      }));
    });

    act(() => {
      ref.state.view?.dispatch({
        changes: { from: 5, to: 5, insert: "!" },
      });
    });

    expect(ref.state.view?.state.doc.toString()).toBe("hello!");

    act(() => {
      root.render(createElement(Harness, {
        doc: "hello",
        docPath: "draft.md",
      }));
    });

    expect(ref.state.view?.state.doc.toString()).toBe("hello!");
  });

  it("preserves selection and scroll when a save sync rerender matches the live editor doc", () => {
    const ref: HarnessRef = {
      state: null as unknown as UseEditorReturn,
    };
    const Harness = createHarness(ref);
    const initialDoc = [
      "# Draft",
      "",
      "Line one",
      "Line two",
      "Line three",
      "Line four",
    ].join("\n");

    act(() => {
      root.render(createElement(Harness, {
        doc: initialDoc,
        docPath: "draft.md",
      }));
    });

    act(() => {
      ref.state.view?.dispatch({
        changes: { from: ref.state.view.state.doc.length, to: ref.state.view.state.doc.length, insert: "\nSaved line" },
      });
      ref.state.view?.dispatch({ selection: { anchor: 18 } });
      if (ref.state.view) {
        ref.state.view.scrollDOM.scrollTop = 240;
      }
    });

    const liveDoc = ref.state.view?.state.doc.toString();
    expect(liveDoc).toBe(`${initialDoc}\nSaved line`);
    expect(ref.state.view?.state.selection.main.head).toBe(18);
    expect(ref.state.view?.scrollDOM.scrollTop).toBe(240);

    act(() => {
      root.render(createElement(Harness, {
        doc: liveDoc ?? "",
        docPath: "draft.md",
      }));
    });

    expect(ref.state.view?.state.doc.toString()).toBe(liveDoc);
    expect(ref.state.view?.state.selection.main.head).toBe(18);
    expect(ref.state.view?.scrollDOM.scrollTop).toBe(240);
  });

  it("remaps include source regions through user edits", async () => {
    const ref: HarnessRef = {
      state: null as unknown as UseEditorReturn,
    };
    const Harness = createHarness(ref);
    const fs = new MemoryFileSystem({
      "main.md": [
        "# Main",
        "",
        "::: {.include}",
        "chapter.md",
        ":::",
        "",
        "# End",
      ].join("\n"),
      "chapter.md": "Included section\n",
    });

    await act(async () => {
      root.render(createElement(Harness, {
        doc: await fs.readFile("main.md"),
        docPath: "main.md",
        fs,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const sourceMap = window.__cfSourceMap;
    expect(sourceMap).not.toBeNull();
    const initialRegion = sourceMap?.regions[0];
    expect(initialRegion).toBeDefined();
    const initialFrom = initialRegion?.from ?? -1;

    act(() => {
      ref.state.view?.dispatch({
        changes: { from: 0, insert: "Intro\n" },
      });
    });

    expect(window.__cfSourceMap?.regions[0].from).toBe(initialFrom + "Intro\n".length);
    expect(window.__cfSourceMap?.regionAt(initialFrom)).toBeNull();
    expect(window.__cfSourceMap?.regionAt(initialFrom + "Intro\n".length)?.file).toBe("chapter.md");
  });
});
