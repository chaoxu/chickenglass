import { describe, expect, it, vi } from "vitest";

import { mountEditor } from "./editor";

describe("mountEditor", () => {
  it("mounts with an empty document by default", () => {
    const parent = document.createElement("div");

    const editor = mountEditor({ parent });

    expect(editor.getDoc()).toBe("");
    expect(editor.getMode()).toBe("rich");
    expect(parent.querySelector(".cm-editor")).toBeTruthy();

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
