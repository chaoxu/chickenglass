import { act, createElement, type FC, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyEditorDocumentChanges,
  type EditorDocumentChange,
} from "../../lib/editor-doc-change";
import type { MarkdownEditorHandle } from "../../lexical/markdown-editor-types";
import {
  type EditorTransactionIntent,
  type EditorTransactionResult,
  useEditorTransactions,
} from "./use-editor-transactions";

interface HarnessRef {
  result: ReturnType<typeof useEditorTransactions>;
}

interface HarnessOptions {
  readonly currentPath: string | null;
  readonly editorDoc: string;
  readonly handle: MarkdownEditorHandle | null;
  readonly sessionDoc: string;
}

function createHandle(peekDoc: string): MarkdownEditorHandle {
  return {
    applyChanges: vi.fn(),
    focus: vi.fn(),
    flushPendingEdits: vi.fn(),
    getDoc: vi.fn(() => peekDoc),
    getSelection: vi.fn(() => ({ anchor: 0, focus: 0, from: 0, to: 0 })),
    peekDoc: vi.fn(() => peekDoc),
    peekSelection: vi.fn(() => ({ anchor: 0, focus: 0, from: 0, to: 0 })),
    insertText: vi.fn(),
    setDoc: vi.fn(),
    setSelection: vi.fn(),
  };
}

function createHarness({
  currentPath,
  editorDoc,
  handle,
  sessionDoc,
}: HarnessOptions): {
  readonly Harness: FC;
  readonly ref: HarnessRef;
  readonly editorHandleRef: MutableRefObject<MarkdownEditorHandle | null>;
  readonly getSessionCurrentDocText: () => string;
  readonly handleDocChange: (changes: readonly EditorDocumentChange[]) => void;
} {
  const ref: HarnessRef = {
    result: null as unknown as ReturnType<typeof useEditorTransactions>,
  };
  const editorHandleRef: MutableRefObject<MarkdownEditorHandle | null> = {
    current: handle,
  };
  let currentSessionDoc = sessionDoc;
  const getSessionCurrentDocText = vi.fn(() => currentSessionDoc);
  const handleDocChange = vi.fn((changes: readonly EditorDocumentChange[]) => {
    currentSessionDoc = applyEditorDocumentChanges(currentSessionDoc, changes);
  });

  const Harness: FC = () => {
    ref.result = useEditorTransactions({
      currentPath,
      editorDoc,
      editorHandleRef,
      getSessionCurrentDocText,
      handleDocChange,
    });
    return null;
  };

  return {
    Harness,
    editorHandleRef,
    getSessionCurrentDocText,
    handleDocChange,
    ref,
  };
}

describe("useEditorTransactions", () => {
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

  it("flushes pending editor edits before running a document transaction", () => {
    const handle = createHandle("# A edited\n");
    const {
      Harness,
      getSessionCurrentDocText,
      handleDocChange,
      ref,
    } = createHarness({
      currentPath: "a.md",
      editorDoc: "# A\n",
      handle,
      sessionDoc: "# A\n",
    });

    act(() => root.render(createElement(Harness)));

    let result: EditorTransactionResult<string> | null = null;
    act(() => {
      result = ref.result.runEditorTransaction(
        "debug-read",
        getSessionCurrentDocText,
      );
    });

    const getSelectionOrder = vi.mocked(handle.getSelection).mock.invocationCallOrder[0];
    const flushOrder = vi.mocked(handle.flushPendingEdits).mock.invocationCallOrder[0];
    const peekDocOrder = vi.mocked(handle.peekDoc).mock.invocationCallOrder[0];
    expect(getSelectionOrder).toBeLessThan(flushOrder);
    expect(flushOrder).toBeLessThan(peekDocOrder);
    expect(handleDocChange).toHaveBeenCalledWith([{
      from: 3,
      insert: " edited",
      to: 3,
    }]);
    expect(result).toEqual({
      flush: {
        shouldDeferModeSwitch: true,
      },
      intent: "debug-read",
      value: "# A edited\n",
    });
  });

  it("runs transactions without editor flushing when no document is active", () => {
    const handle = createHandle("# A edited\n");
    const {
      Harness,
      getSessionCurrentDocText,
      handleDocChange,
      ref,
    } = createHarness({
      currentPath: null,
      editorDoc: "",
      handle,
      sessionDoc: "",
    });

    act(() => root.render(createElement(Harness)));

    let result: EditorTransactionResult<string> | null = null;
    act(() => {
      result = ref.result.runEditorTransaction(
        "save",
        getSessionCurrentDocText,
      );
    });

    expect(handle.getSelection).not.toHaveBeenCalled();
    expect(handle.flushPendingEdits).not.toHaveBeenCalled();
    expect(handleDocChange).not.toHaveBeenCalled();
    expect(result?.flush.shouldDeferModeSwitch).toBe(false);
    expect(result?.value).toBe("");
  });

  it("defers mode switches when React editor state has not caught up", () => {
    const handle = createHandle("# A edited\n");
    const {
      Harness,
      handleDocChange,
      ref,
    } = createHarness({
      currentPath: "a.md",
      editorDoc: "# A\n",
      handle,
      sessionDoc: "# A edited\n",
    });

    act(() => root.render(createElement(Harness)));

    const intents: EditorTransactionIntent[] = [
      "mode-switch",
      "search-navigation",
      "source-selection",
    ];

    for (const intent of intents) {
      const result = ref.result.runEditorTransaction(intent, () => undefined);
      expect(result.intent).toBe(intent);
      expect(result.flush.shouldDeferModeSwitch).toBe(true);
    }
    expect(handleDocChange).not.toHaveBeenCalled();
  });
});
