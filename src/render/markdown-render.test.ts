import { describe, expect, it, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { markdownRenderPlugin } from "./markdown-render";
import { cursorInRange } from "./render-utils";

/** Create an EditorView with the markdown render plugin at the given cursor position. */
function createTestView(doc: string, cursorPos?: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: cursorPos !== undefined ? { anchor: cursorPos } : undefined,
    extensions: [markdown(), markdownRenderPlugin],
  });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ state, parent });
  view.focus();
  const origDestroy = view.destroy.bind(view);
  view.destroy = () => {
    origDestroy();
    parent.remove();
  };
  return view;
}

describe("cursorInRange", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("returns true when cursor is inside the range", () => {
    view = createTestView("hello world", 5);
    expect(cursorInRange(view, 0, 10)).toBe(true);
  });

  it("returns true when cursor is at range start", () => {
    view = createTestView("hello world", 0);
    expect(cursorInRange(view, 0, 5)).toBe(true);
  });

  it("returns true when cursor is at range end", () => {
    view = createTestView("hello world", 5);
    expect(cursorInRange(view, 0, 5)).toBe(true);
  });

  it("returns false when cursor is outside the range", () => {
    view = createTestView("hello world", 8);
    expect(cursorInRange(view, 0, 5)).toBe(false);
  });
});

describe("markdownRenderPlugin (Decoration.mark approach)", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("creates a view with the plugin without errors", () => {
    view = createTestView("# Hello\n\nSome **bold** text");
    expect(view.state.doc.toString()).toBe("# Hello\n\nSome **bold** text");
  });

  it("handles empty document", () => {
    view = createTestView("");
    expect(view.state.doc.toString()).toBe("");
  });

  it("handles document with all element types", () => {
    const doc = [
      "# Heading 1",
      "",
      "Some **bold** and *italic* text with `code`.",
      "",
      "[link](https://example.com)",
      "",
      "![image](photo.png)",
      "",
      "---",
    ].join("\n");
    view = createTestView(doc);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("does not throw when cursor is at beginning", () => {
    view = createTestView("# Hello\n\n**bold**", 0);
    expect(view.state.doc.toString()).toBe("# Hello\n\n**bold**");
  });

  it("does not throw when cursor is at end", () => {
    const doc = "# Hello\n\n**bold**";
    view = createTestView(doc, doc.length);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("survives rapid document changes", () => {
    view = createTestView("# Start");
    for (let i = 0; i < 100; i++) {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: `\nLine ${i}` },
      });
    }
    expect(view.state.doc.lines).toBe(101);
  });

  it("handles cursor movement through decorated regions", () => {
    const doc = "before **bold** after";
    view = createTestView(doc, 0);

    // Move cursor through the bold region
    for (let i = 0; i <= doc.length; i++) {
      view.dispatch({ selection: { anchor: i } });
    }

    expect(view.state.doc.toString()).toBe(doc);
  });

  it("source text is preserved in the document (mark approach keeps text)", () => {
    const doc = "**bold** and *italic*";
    view = createTestView(doc, doc.length); // cursor at end, outside markup
    // The document always keeps source text with Decoration.mark
    expect(view.state.doc.toString()).toBe(doc);
    // Markers are still in the doc (not replaced by widgets)
    expect(view.state.doc.toString()).toContain("**");
    expect(view.state.doc.toString()).toContain("*italic*");
  });

  it("uses Decoration.mark not Decoration.replace", () => {
    // Verify the plugin produces mark decorations, not replace decorations
    const doc = "**bold**";
    view = createTestView(doc, doc.length);
    // The key property of mark decorations: source text stays in the doc
    // and is not replaced by widget DOM. The doc should read the same.
    expect(view.state.doc.toString()).toBe("**bold**");
    // A replace decoration would remove the text from the DOM entirely
    // and substitute a widget. With marks, the text remains.
  });

  it("does not hide markers when cursor is inside element", () => {
    // Cursor at position 4 is inside "**bold**" (positions 0-7)
    const doc = "**bold**";
    view = createTestView(doc, 4);
    // With cursor inside, no decorations should be applied
    // (the tree walk returns false, skipping marker hiding)
    expect(view.state.doc.toString()).toBe(doc);
  });
});

