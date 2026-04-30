import { describe, expect, it, vi } from "vitest";

import { DOCUMENT_SURFACE_CLASS } from "./src/document-surface-classes";
import { mountEditor } from "./editor";

describe("mountEditor", () => {
  it("mounts with an empty document by default", () => {
    const parent = document.createElement("div");

    const editor = mountEditor({ parent });

    expect(editor.getDoc()).toBe("");
    expect(editor.getMode()).toBe("rich");
    const editorElement = parent.querySelector(".cm-editor");
    expect(editorElement).toBeTruthy();
    expect(editorElement?.classList.contains(DOCUMENT_SURFACE_CLASS.surface)).toBe(true);
    const contentElement = parent.querySelector(".cm-content");
    expect(contentElement?.classList.contains(DOCUMENT_SURFACE_CLASS.flow)).toBe(true);

    editor.unmount();
  });

  it("applies the requested initial source mode without firing mode callbacks", () => {
    const onModeChange = vi.fn();
    const parent = document.createElement("div");

    const editor = mountEditor({
      parent,
      doc: "# Title",
      mode: "source",
      onModeChange,
    });

    expect(editor.getMode()).toBe("source");
    expect(onModeChange).not.toHaveBeenCalled();

    editor.unmount();
  });

  it("setDoc replaces fenced content without triggering onChange", () => {
    const onChange = vi.fn();
    const parent = document.createElement("div");
    const editor = mountEditor({
      parent,
      doc: "::: {.theorem}\nBody\n:::",
      onChange,
    });

    editor.setDoc("# Replaced");

    expect(editor.getDoc()).toBe("# Replaced");
    expect(onChange).not.toHaveBeenCalled();

    editor.unmount();
  });

  it("reports programmatic mode changes through onModeChange", () => {
    const onModeChange = vi.fn();
    const parent = document.createElement("div");
    const editor = mountEditor({
      parent,
      onModeChange,
    });

    editor.setMode("source");
    editor.setMode("rich");

    expect(onModeChange.mock.calls).toEqual([["source"], ["rich"]]);

    editor.unmount();
  });
});
