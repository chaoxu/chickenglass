import { render, screen, waitFor } from "@testing-library/react";
import {
  createElement,
  useLayoutEffect,
  useRef,
  type ComponentProps,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileSystemProvider } from "../app/contexts/file-system-context";
import { MemoryFileSystem } from "../app/file-manager";
import { LexicalSurfaceEditableProvider } from "./editability-context";
import { EmbeddedFieldEditor } from "./embedded-field-editor";
import type { MarkdownEditorHandle } from "./markdown-editor-types";
import { LexicalRenderContextProvider } from "./render-context";

const { scheduleRegisteredSurfaceFocusMock } = vi.hoisted(() => ({
  scheduleRegisteredSurfaceFocusMock: vi.fn(() => () => {}),
}));

vi.mock("./editor-focus-plugin", () => ({
  scheduleRegisteredSurfaceFocus: scheduleRegisteredSurfaceFocusMock,
}));

vi.mock("./rich-markdown-editor", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  function MockLexicalRichMarkdownEditor({
    doc,
    editable = true,
    editorClassName,
    onEditorReady,
    onRootElementChange,
  }: Pick<
    ComponentProps<typeof import("./rich-markdown-editor").LexicalRichMarkdownEditor>,
    "doc" | "editable" | "editorClassName" | "onEditorReady" | "onRootElementChange"
  >) {
    const rootRef = React.useRef<HTMLDivElement | null>(null);

    React.useLayoutEffect(() => {
      const selection = { anchor: 0, focus: 0, from: 0, to: 0 };
      const handle: MarkdownEditorHandle = {
        applyChanges: () => {},
        focus: () => {},
        flushPendingEdits: () => null,
        getDoc: () => doc,
        getSelection: () => selection,
        insertText: () => {},
        peekDoc: () => doc,
        peekSelection: () => selection,
        setDoc: () => {},
        setSelection: () => {},
      };
      onEditorReady?.(handle, null as never);
    }, [doc, onEditorReady]);

    React.useLayoutEffect(() => {
      onRootElementChange?.(rootRef.current);
      return () => {
        onRootElementChange?.(null);
      };
    }, [onRootElementChange]);

    return createElement("div", {
      ref: rootRef,
      className: editorClassName,
      "data-editable": String(editable),
      "data-testid": "nested-editor",
    });
  }

  return {
    LexicalRichMarkdownEditor: MockLexicalRichMarkdownEditor,
  };
});

afterEach(() => {
  scheduleRegisteredSurfaceFocusMock.mockReset();
});

describe("EmbeddedFieldEditor", () => {
  it("avoids lifecycle-time flush warnings when pointer activation happens during layout", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fs = new MemoryFileSystem();

    function PointerActivationHarness() {
      const hostRef = useRef<HTMLDivElement | null>(null);

      useLayoutEffect(() => {
        hostRef.current
          ?.querySelector<HTMLElement>(".cf-embedded-field-shell")
          ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      }, []);

      return (
        <div ref={hostRef}>
          <EmbeddedFieldEditor
            activation="focus"
            className="embedded-field"
            doc="Title"
            editable
            family="title"
            namespace="embedded-field-test"
          />
        </div>
      );
    }

    try {
      render(
        <FileSystemProvider value={fs}>
          <LexicalRenderContextProvider doc="Host doc">
            <LexicalSurfaceEditableProvider editable>
              <PointerActivationHarness />
            </LexicalSurfaceEditableProvider>
          </LexicalRenderContextProvider>
        </FileSystemProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("nested-editor")).toHaveAttribute("data-editable", "true");
      });
      expect(scheduleRegisteredSurfaceFocusMock).toHaveBeenCalledTimes(1);
      expect(
        consoleErrorSpy.mock.calls.flat().join(" "),
      ).not.toContain("flushSync was called from inside a lifecycle method");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
