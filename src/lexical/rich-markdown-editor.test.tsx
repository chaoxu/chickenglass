import { act, fireEvent, render, waitFor } from "@testing-library/react";
import type { LexicalEditor } from "lexical";
import {
  $createNodeSelection,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  CLICK_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import { createElement, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { FileSystemProvider } from "../app/contexts/file-system-context";
import { MemoryFileSystem } from "../app/file-manager";
import { clearFrontendPerf, getFrontendPerfSnapshot } from "../lib/perf";
import type { MarkdownEditorHandle } from "./markdown-editor-types";
import { registerCoflatDecoratorRenderers } from "./renderers/block-renderers";
import { LexicalRichMarkdownEditor } from "./rich-markdown-editor";
import { HEADING_SOURCE_SELECTOR } from "./source-position-contract";
import { ACTIVATE_STRUCTURE_EDIT_COMMAND } from "./structure-edit-plugin";

type RichMarkdownEditorProps = ComponentProps<typeof LexicalRichMarkdownEditor>;

registerCoflatDecoratorRenderers();

const TABLE_MD = `| H1 | H2 |
| --- | --- |
| a | b |`;

const DISPLAY_MATH_MD = `$$
x + 1
$$`;

async function mountEditor(overrides: Partial<RichMarkdownEditorProps> = {}) {
  let editor: LexicalEditor | null = null;
  let handle: MarkdownEditorHandle | null = null;
  let currentProps: RichMarkdownEditorProps = {
    doc: "seed",
    onEditorReady: (nextHandle, nextEditor) => {
      handle = nextHandle;
      editor = nextEditor;
    },
    preserveLocalHistory: true,
    testId: null,
    ...overrides,
  };
  const fs = new MemoryFileSystem();
  const view = render(
    createElement(
      FileSystemProvider,
      { value: fs },
      createElement(LexicalRichMarkdownEditor, currentProps),
    ),
  );

  await waitFor(() => expect(editor).not.toBeNull());
  await waitFor(() => expect(handle).not.toBeNull());

  return {
    get editor(): LexicalEditor {
      if (!editor) {
        throw new Error("expected editor to be ready");
      }
      return editor;
    },
    get handle(): MarkdownEditorHandle {
      if (!handle) {
        throw new Error("expected editor handle to be ready");
      }
      return handle;
    },
    rerender(nextOverrides: Partial<RichMarkdownEditorProps> = {}) {
      currentProps = {
        ...currentProps,
        ...nextOverrides,
      };
      view.rerender(
        createElement(
          FileSystemProvider,
          { value: fs },
          createElement(LexicalRichMarkdownEditor, currentProps),
        ),
      );
    },
    unmount() {
      view.unmount();
    },
  };
}

function readSelectionKind(editor: LexicalEditor): "none" | "node" | "other" {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (selection === null) {
      return "none";
    }
    if ($isNodeSelection(selection)) {
      return "node";
    }
    return "other";
  });
}

function getFirstTopLevelKey(editor: LexicalEditor): string {
  const key = editor.getEditorState().read(() => $getRoot().getFirstChild()?.getKey() ?? null);
  if (!key) {
    throw new Error("expected a first top-level node");
  }
  return key;
}

function selectNode(editor: LexicalEditor, key: string): void {
  act(() => {
    editor.update(() => {
      const selection = $createNodeSelection();
      selection.add(key);
      $setSelection(selection);
    }, { discrete: true });
  });
}

function getPerfSummaryCount(name: string): number {
  return getFrontendPerfSnapshot().summaries.find((entry) => entry.name === name)?.count ?? 0;
}

async function advanceFakeTimersBy(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function runPendingFakeTimers(): Promise<void> {
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
}

function installZeroGeometryMocks(): () => void {
  const textPrototype = Text.prototype as unknown as {
    getBoundingClientRect?: () => DOMRect;
  };
  const elementPrototype = Element.prototype as unknown as {
    getBoundingClientRect?: () => DOMRect;
  };
  const rangePrototype = Range.prototype as unknown as {
    getBoundingClientRect?: () => DOMRect;
  };
  const originalTextGetBoundingClientRect = textPrototype.getBoundingClientRect;
  const originalElementGetBoundingClientRect = elementPrototype.getBoundingClientRect;
  const originalRangeGetBoundingClientRect = rangePrototype.getBoundingClientRect;
  const getZeroRect = () => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top: 0,
    width: 0,
    x: 0,
    y: 0,
  });
  textPrototype.getBoundingClientRect = getZeroRect;
  elementPrototype.getBoundingClientRect = getZeroRect;
  rangePrototype.getBoundingClientRect = getZeroRect;

  return () => {
    if (originalTextGetBoundingClientRect) {
      textPrototype.getBoundingClientRect = originalTextGetBoundingClientRect;
    } else {
      delete textPrototype.getBoundingClientRect;
    }
    if (originalElementGetBoundingClientRect) {
      elementPrototype.getBoundingClientRect = originalElementGetBoundingClientRect;
    } else {
      delete elementPrototype.getBoundingClientRect;
    }
    if (originalRangeGetBoundingClientRect) {
      rangePrototype.getBoundingClientRect = originalRangeGetBoundingClientRect;
    } else {
      delete rangePrototype.getBoundingClientRect;
    }
  };
}

describe("ClickableLinkPlugin in read-only mode", () => {
  it("renders link as anchor in read-only mode", async () => {
    const editor = await mountEditor({
      doc: "[example](https://example.com)",
      editable: false,
    });

    try {
      await waitFor(() => {
        const anchor = editor.editor.getRootElement()?.querySelector("a");
        expect(anchor).not.toBeNull();
        expect(anchor?.getAttribute("href")).toBe("https://example.com");
        expect(anchor?.textContent).toBe("example");
      });
    } finally {
      editor.unmount();
    }
  });

  it("link source editor intercepts clicks in editable mode", async () => {
    const editor = await mountEditor({
      doc: "[example](https://example.com)",
      editable: true,
    });

    try {
      await waitFor(() => {
        const anchor = editor.editor.getRootElement()?.querySelector("a");
        expect(anchor).not.toBeNull();
      });

      let handled = false;
      const cleanup = editor.editor.registerCommand(
        CLICK_COMMAND,
        () => {
          handled = true;
          return false;
        },
        0,
      );

      const anchor = editor.editor.getRootElement()?.querySelector("a");
      act(() => {
        anchor?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(handled).toBe(true);
      cleanup();
    } finally {
      editor.unmount();
    }
  });
});

describe("LexicalRichMarkdownEditor nested history", () => {
  it("does not publish mount-only markdown normalization as a document edit", async () => {
    const onTextChange = vi.fn();
    const editor = await mountEditor({
      doc: ":::: {.proof}\nBody text.\n::::",
      onTextChange,
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(onTextChange).not.toHaveBeenCalled();
    } finally {
      editor.unmount();
    }
  });

  it("still publishes explicit handle writes when mount-only changes are guarded", async () => {
    const onTextChange = vi.fn();
    const editor = await mountEditor({
      doc: "seed",
      onTextChange,
    });
    const restoreGeometry = installZeroGeometryMocks();

    try {
      act(() => {
        editor.handle.insertText("x");
      });
      await waitFor(() => expect(onTextChange).toHaveBeenCalledWith("xseed"));
    } finally {
      editor.unmount();
      restoreGeometry();
    }
  });

  it("keeps sequential handle inserts in rich mode aligned with the tracked selection", async () => {
    const onTextChange = vi.fn();
    const editor = await mountEditor({
      doc: "Alpha Beta",
      onTextChange,
    });
    const restoreGeometry = installZeroGeometryMocks();

    try {
      act(() => {
        editor.handle.setSelection(5);
        editor.handle.insertText("1");
        editor.handle.insertText("2");
        editor.handle.insertText("3");
      });

      await waitFor(() => {
        expect(editor.handle.getDoc()).toBe("Alpha123 Beta");
      });
      expect(onTextChange).toHaveBeenLastCalledWith("Alpha123 Beta");
      expect(editor.handle.getSelection()).toEqual({
        anchor: 8,
        focus: 8,
        from: 8,
        to: 8,
      });
    } finally {
      editor.unmount();
      restoreGeometry();
    }
  });

  it("preserves undo history across editable blur/focus toggles", async () => {
    const editor = await mountEditor();

    try {
      act(() => {
        editor.handle.setDoc("draft one");
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft one"));

      act(() => {
        editor.rerender({ doc: "draft one" });
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft one"));

      act(() => {
        editor.handle.setDoc("draft two ");
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft two "));

      act(() => {
        editor.rerender({ doc: "draft two", editable: false });
      });
      await waitFor(() => {
        expect(editor.editor.isEditable()).toBe(false);
        expect(editor.handle.getDoc()).toBe("draft two");
      });

      act(() => {
        editor.rerender({ editable: true });
      });
      await waitFor(() => expect(editor.editor.isEditable()).toBe(true));

      act(() => {
        editor.editor.dispatchCommand(UNDO_COMMAND, undefined);
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft one"));
    } finally {
      editor.unmount();
    }
  });

  it("merges the immediate parent echo into the current undo step", async () => {
    const editor = await mountEditor();

    try {
      act(() => {
        editor.handle.setDoc("draft one");
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft one"));

      act(() => {
        editor.rerender({ doc: "draft one" });
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft one"));

      act(() => {
        editor.handle.setDoc("draft two ");
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft two "));

      act(() => {
        editor.rerender({ doc: "draft two" });
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft two"));

      act(() => {
        editor.editor.dispatchCommand(UNDO_COMMAND, undefined);
      });
      await waitFor(() => expect(editor.handle.getDoc()).toBe("draft one"));
    } finally {
      editor.unmount();
    }
  });
});

describe("TableActionMenuPlugin", () => {
  it("does not expose header-column actions for pipe tables", async () => {
    const editor = await mountEditor({
      doc: TABLE_MD,
      editable: true,
    });

    try {
      const tableCellSelector = "table.cf-lexical-table-block th";
      await waitFor(() => {
        const tableCell = editor.editor.getRootElement()?.querySelector(tableCellSelector);
        expect(tableCell).not.toBeNull();
      });

      const tableCell = editor.editor.getRootElement()?.querySelector(tableCellSelector);
      if (!tableCell) {
        throw new Error("expected a table header cell to open the action menu");
      }

      act(() => {
        fireEvent.contextMenu(tableCell);
      });

      await waitFor(() => {
        const menu = document.querySelector(".cf-table-action-menu");
        expect(menu).not.toBeNull();
        expect(menu?.textContent).toContain("Insert row above");
        expect(menu?.textContent).not.toContain("header column");
      });
    } finally {
      editor.unmount();
    }
  });
});

describe("StructureEditProvider selection ownership", () => {
  it("releases parent selection when activating a structure surface by command", async () => {
    const editor = await mountEditor({
      doc: DISPLAY_MATH_MD,
      editable: true,
    });

    try {
      await waitFor(() => {
        expect(
          editor.editor.getRootElement()?.querySelector(
            ".cf-lexical-display-math-body",
          ),
        ).not.toBeNull();
      });
      const blockKey = getFirstTopLevelKey(editor.editor);
      selectNode(editor.editor, blockKey);
      expect(readSelectionKind(editor.editor)).toBe("node");

      let handled = false;
      act(() => {
        handled = editor.editor.dispatchCommand(ACTIVATE_STRUCTURE_EDIT_COMMAND, {
          blockKey,
          surface: "display-math-source",
          variant: "display-math",
        });
      });

      expect(handled).toBe(true);
      await waitFor(() => {
        expect(readSelectionKind(editor.editor)).toBe("none");
      });
      await waitFor(() => {
        expect(
          editor.editor.getRootElement()?.querySelector(
            ".cf-lexical-structure-source-editor--math",
          ),
        ).not.toBeNull();
      });
    } finally {
      editor.unmount();
    }
  });

  it("opens a structure surface from a selected block without repairing NodeSelection on click", async () => {
    const editor = await mountEditor({
      doc: DISPLAY_MATH_MD,
      editable: true,
    });

    try {
      await waitFor(() => {
        expect(
          editor.editor.getRootElement()?.querySelector(
            ".cf-lexical-display-math-body",
          ),
        ).not.toBeNull();
      });
      const blockKey = getFirstTopLevelKey(editor.editor);
      selectNode(editor.editor, blockKey);
      expect(readSelectionKind(editor.editor)).toBe("node");

      const body = editor.editor.getRootElement()?.querySelector(
        ".cf-lexical-display-math-body",
      );
      if (!body) {
        throw new Error("expected display math body");
      }

      act(() => {
        fireEvent.click(body);
      });

      await waitFor(() => {
        expect(
          editor.editor.getRootElement()?.querySelector(
            ".cf-lexical-structure-source-editor--math",
          ),
        ).not.toBeNull();
      });
      expect(readSelectionKind(editor.editor)).toBe("none");
    } finally {
      editor.unmount();
    }
  });
});

describe("__editor selection bridge (rich mode)", () => {
  it("publishes live rich caret movement with source offsets", async () => {
    const onSelectionChange = vi.fn();
    const editor = await mountEditor({ doc: "Alpha Beta", onSelectionChange });

    try {
      onSelectionChange.mockClear();
      act(() => {
        editor.editor.update(() => {
          const paragraph = $getRoot().getFirstChild();
          if (!$isElementNode(paragraph)) {
            throw new Error("expected paragraph");
          }
          const text = paragraph.getFirstChild();
          if (!$isTextNode(text)) {
            throw new Error("expected text node");
          }
          text.select(3, 3);
        }, { discrete: true });
      });

      await waitFor(() => {
        expect(onSelectionChange).toHaveBeenLastCalledWith({
          anchor: 3,
          focus: 3,
          from: 3,
          to: 3,
        });
      });
    } finally {
      editor.unmount();
    }
  });

  it("publishes live rich range selections with source offsets", async () => {
    const onSelectionChange = vi.fn();
    const editor = await mountEditor({ doc: "Alpha Beta", onSelectionChange });

    try {
      onSelectionChange.mockClear();
      act(() => {
        editor.editor.update(() => {
          const paragraph = $getRoot().getFirstChild();
          if (!$isElementNode(paragraph)) {
            throw new Error("expected paragraph");
          }
          const text = paragraph.getFirstChild();
          if (!$isTextNode(text)) {
            throw new Error("expected text node");
          }
          text.select(6, 10);
        }, { discrete: true });
      });

      await waitFor(() => {
        expect(onSelectionChange).toHaveBeenLastCalledWith({
          anchor: 6,
          focus: 10,
          from: 6,
          to: 10,
        });
      });
    } finally {
      editor.unmount();
    }
  });

  it("setSelection moves the Lexical selection for a prose document with no tagged blocks", async () => {
    const editor = await mountEditor({ doc: "plain prose only" });

    try {
      act(() => {
        editor.handle.setSelection(3, 3);
      });

      const anchorInFirstBlock = editor.editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }
        const firstChild = $getRoot().getFirstChild();
        return selection.anchor.getNode().getTopLevelElement()?.getKey() === firstChild?.getKey();
      });
      expect(anchorInFirstBlock).toBe(true);
    } finally {
      editor.unmount();
    }
  });

  it("trusts a successful collapsed rich setSelection without a second source-span read", async () => {
    const editor = await mountEditor({ doc: "plain prose only" });

    try {
      clearFrontendPerf();
      act(() => {
        editor.handle.setSelection(3, 3);
      });

      expect(getPerfSummaryCount("lexical.createSourceSpanIndex")).toBe(1);
    } finally {
      editor.unmount();
      clearFrontendPerf();
    }
  });

  it("clears stale fallback state after a later successful collapsed prose setSelection", async () => {
    const doc = "Alpha Beta";
    const insertAt = doc.indexOf(" Beta");
    const onTextChange = vi.fn();
    const editor = await mountEditor({ doc, onTextChange });
    const restoreGeometry = installZeroGeometryMocks();

    try {
      act(() => {
        editor.handle.setSelection(insertAt);
        editor.editor.update(() => {
          $setSelection(null);
        }, { discrete: true });
        editor.handle.insertText("1");
        editor.handle.setSelection(0);
        editor.handle.insertText("Z");
      });

      const expectedDoc = "ZAlpha1 Beta";
      expect(editor.handle.getDoc()).toBe(expectedDoc);
      expect(onTextChange).toHaveBeenLastCalledWith(expectedDoc);
    } finally {
      editor.unmount();
      restoreGeometry();
    }
  });

  it("keeps canonical fallback insertion for collapsed setSelection inside fenced div source", async () => {
    const doc = [
      "::: {.theorem #thm:sample title=\"Sample\"}",
      "Alpha Beta.",
      ":::",
    ].join("\n");
    const insertAt = doc.indexOf("Beta");
    const onTextChange = vi.fn();
    const editor = await mountEditor({ doc, onTextChange });

    try {
      act(() => {
        editor.handle.setSelection(insertAt);
        editor.handle.insertText("Z");
      });

      const expectedDoc = doc.replace("Beta", "ZBeta");
      expect(editor.handle.getDoc()).toBe(expectedDoc);
      expect(onTextChange).toHaveBeenLastCalledWith(expectedDoc);
    } finally {
      editor.unmount();
    }
  });

  it("keeps bridge setSelection when focus is requested before insertion", async () => {
    const doc = [
      "---",
      "title: Bridge Focus",
      "---",
      "",
      "Alpha Beta.",
    ].join("\n");
    const insertAt = doc.indexOf("Beta");
    const onTextChange = vi.fn();
    const editor = await mountEditor({ doc, onTextChange });

    try {
      act(() => {
        editor.handle.setSelection(insertAt);
        editor.handle.focus();
        editor.handle.insertText("Z");
      });

      const expectedDoc = doc.replace("Beta", "ZBeta");
      expect(editor.handle.getDoc()).toBe(expectedDoc);
      expect(onTextChange).toHaveBeenLastCalledWith(expectedDoc);
    } finally {
      editor.unmount();
    }
  });

  it("getSelection reports the live source position when the caret is inside a heading", async () => {
    const editor = await mountEditor({ doc: "# Title\n\nbody" });

    try {
      await waitFor(() => {
        const heading = editor.editor.getRootElement()?.querySelector<HTMLElement>(
          HEADING_SOURCE_SELECTOR,
        );
        expect(heading).not.toBeNull();
      });

      act(() => {
        editor.editor.update(() => {
          const first = $getRoot().getFirstChild();
          if (first && $isElementNode(first)) {
            first.selectStart();
          }
        });
      });

      await waitFor(() => {
        expect(editor.handle.getSelection().anchor).toBe(0);
      });
    } finally {
      editor.unmount();
    }
  });

  it("coalesces bridge inserts when the rich selection cannot accept direct text", async () => {
    const doc = "Alpha Beta";
    const insertAt = doc.indexOf(" Beta");
    const onTextChange = vi.fn();
    const editor = await mountEditor({ doc, onTextChange });
    const restoreGeometry = installZeroGeometryMocks();

    try {
      clearFrontendPerf();
      vi.useFakeTimers();
      act(() => {
        editor.handle.setSelection(insertAt);
        editor.editor.update(() => {
          $setSelection(null);
        }, { discrete: true });
        editor.handle.insertText("1");
        editor.handle.insertText("2");
        editor.handle.insertText("3");
      });

      const expectedDoc = "Alpha123 Beta";
      expect(onTextChange).toHaveBeenLastCalledWith(expectedDoc);
      expect(getPerfSummaryCount("lexical.setLexicalMarkdown")).toBe(0);
      expect(getPerfSummaryCount("lexical.incrementalRichSync")).toBe(0);

      await advanceFakeTimersBy(40);
      expect(getPerfSummaryCount("lexical.incrementalRichSync")).toBe(0);

      await runPendingFakeTimers();

      expect(getPerfSummaryCount("lexical.setLexicalMarkdown")).toBe(0);
      expect(getPerfSummaryCount("lexical.incrementalRichSync")).toBe(1);
      expect(getPerfSummaryCount("lexical.createNodeSourceSpanIndex")).toBeGreaterThanOrEqual(1);
      expect(editor.handle.getDoc()).toBe(expectedDoc);
    } finally {
      vi.useRealTimers();
      editor.unmount();
      restoreGeometry();
      clearFrontendPerf();
    }
  });

  it("does not require rich sync spans for direct bridge inserts", async () => {
    const doc = "Alpha Beta";
    const insertAt = doc.indexOf(" Beta");
    const onTextChange = vi.fn();
    const editor = await mountEditor({ doc, onTextChange });
    const restoreGeometry = installZeroGeometryMocks();

    try {
      clearFrontendPerf();
      act(() => {
        editor.handle.setSelection(insertAt);
        editor.handle.insertText("1");
      });

      expect(onTextChange).toHaveBeenLastCalledWith("Alpha1 Beta");
      expect(editor.handle.getDoc()).toBe("Alpha1 Beta");
      expect(getPerfSummaryCount("lexical.setLexicalMarkdown")).toBe(0);
      expect(getPerfSummaryCount("lexical.incrementalRichSync")).toBe(0);
    } finally {
      editor.unmount();
      restoreGeometry();
      clearFrontendPerf();
    }
  });

  it("incrementally syncs coalesced bridge inserts inside raw blocks", async () => {
    const doc = [
      "::: {.theorem #thm:sample title=\"Sample\"}",
      "Alpha [@thm:main-upper] Beta.",
      "",
      "Second paragraph.",
      ":::",
      "",
      "Tail paragraph.",
    ].join("\n");
    const insertAt = doc.indexOf(" Beta");
    const onTextChange = vi.fn();
    const editor = await mountEditor({ doc, onTextChange });
    const restoreGeometry = installZeroGeometryMocks();

    try {
      clearFrontendPerf();
      vi.useFakeTimers();
      act(() => {
        editor.handle.setSelection(insertAt);
        editor.editor.update(() => {
          $setSelection(null);
        }, { discrete: true });
        editor.handle.insertText("1");
        editor.handle.insertText("2");
        editor.handle.insertText("3");
      });

      const expectedDoc = doc.replace(" Beta", "123 Beta");
      expect(onTextChange).toHaveBeenLastCalledWith(expectedDoc);
      expect(getPerfSummaryCount("lexical.setLexicalMarkdown")).toBe(0);
      expect(getPerfSummaryCount("lexical.incrementalRichSync")).toBe(0);

      await advanceFakeTimersBy(40);
      expect(getPerfSummaryCount("lexical.incrementalRichSync")).toBe(0);

      await runPendingFakeTimers();

      expect(getPerfSummaryCount("lexical.setLexicalMarkdown")).toBe(0);
      expect(getPerfSummaryCount("lexical.incrementalRichSync")).toBe(1);
      expect(getPerfSummaryCount("lexical.createNodeSourceSpanIndex")).toBeGreaterThanOrEqual(1);
      expect(editor.handle.getDoc()).toBe(expectedDoc);
    } finally {
      vi.useRealTimers();
      editor.unmount();
      restoreGeometry();
      clearFrontendPerf();
    }
  });

  it("cancels stale pending bridge sync timers when an explicit flush applies the latest doc", async () => {
    const doc = "Alpha Beta";
    const insertAt = doc.indexOf(" Beta");
    const onTextChange = vi.fn();
    const editor = await mountEditor({ doc, onTextChange });
    const restoreGeometry = installZeroGeometryMocks();

    try {
      clearFrontendPerf();
      vi.useFakeTimers();
      act(() => {
        editor.handle.setSelection(insertAt);
        editor.editor.update(() => {
          $setSelection(null);
        }, { discrete: true });
        editor.handle.insertText("1");
      });

      await advanceFakeTimersBy(40);
      act(() => {
        editor.handle.insertText("2");
      });

      const expectedDoc = "Alpha12 Beta";
      expect(editor.handle.flushPendingEdits()).toBe(expectedDoc);
      expect(onTextChange).toHaveBeenLastCalledWith(expectedDoc);
      expect(getPerfSummaryCount("lexical.setLexicalMarkdown")).toBe(0);
      expect(getPerfSummaryCount("lexical.incrementalRichSync")).toBe(1);

      await runPendingFakeTimers();

      expect(getPerfSummaryCount("lexical.incrementalRichSync")).toBe(1);
      expect(editor.handle.getDoc()).toBe(expectedDoc);
    } finally {
      vi.useRealTimers();
      editor.unmount();
      restoreGeometry();
      clearFrontendPerf();
    }
  });
});
