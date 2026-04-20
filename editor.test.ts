import { describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

import { mountEditor } from "./editor";
import { SOURCE_POSITION_ATTR } from "./src/lexical/source-position-contract";

describe("mountEditor", () => {
  it("mounts with an empty document by default", () => {
    const parent = document.createElement("div");

    const editor = mountEditor({ parent });

    expect(editor.getDoc()).toBe("");
    expect(editor.getMode()).toBe("lexical");
    expect(parent.querySelector('[data-testid="lexical-editor"]')).toBeTruthy();

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
    editor.setMode("lexical");

    expect(onModeChange.mock.calls).toEqual([["source"], ["lexical"]]);

    editor.unmount();
  });

  it("installs decorator renderers for standalone raw blocks", async () => {
    const parent = document.createElement("div");
    const editor = mountEditor({
      parent,
      doc: [
        "::: {.theorem} Renderer Title",
        "Renderer body.",
        ":::",
        "",
        "See this note[^render].",
        "",
        "[^render]: Footnote body.",
      ].join("\n"),
    });

    await waitFor(() => {
      expect(parent.querySelector(".cf-lexical-block--theorem")).toBeTruthy();
    });

    expect(parent.querySelector(`[${SOURCE_POSITION_ATTR.rawBlockFallback}]`)).toBeNull();
    expect(parent.querySelector("[data-footnote-fallback]")).toBeNull();
    expect(parent.textContent).toContain("Renderer body.");

    editor.unmount();
  });
});
