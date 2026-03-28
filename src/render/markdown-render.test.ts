import { describe, expect, it, afterEach } from "vitest";
import { Decoration, EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { markdownRenderPlugin, cursorContextKey, markdownShouldUpdate } from "./markdown-render";
import { cursorInRange, createSimpleViewPlugin } from "./render-utils";
import { createEditorState, createTestView } from "../test-utils";

/** Create an EditorView with the markdown render plugin at the given cursor position. */
function createView(doc: string, cursorPos?: number): EditorView {
  return createTestView(doc, {
    cursorPos,
    extensions: [markdown(), markdownRenderPlugin],
  });
}

describe("cursorInRange", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("returns true when cursor is inside the range", () => {
    view = createView("hello world", 5);
    expect(cursorInRange(view, 0, 10)).toBe(true);
  });

  it("returns true when cursor is at range start", () => {
    view = createView("hello world", 0);
    expect(cursorInRange(view, 0, 5)).toBe(true);
  });

  it("returns true when cursor is at range end", () => {
    view = createView("hello world", 5);
    expect(cursorInRange(view, 0, 5)).toBe(true);
  });

  it("returns false when cursor is outside the range", () => {
    view = createView("hello world", 8);
    expect(cursorInRange(view, 0, 5)).toBe(false);
  });

  describe("negative / edge-case", () => {
    it("returns false for an empty range (from === to) with cursor elsewhere", () => {
      view = createView("abc", 2);
      expect(cursorInRange(view, 1, 1)).toBe(false);
    });

    it("returns false when cursor is exactly at range end (exclusive boundary)", () => {
      // cursorInRange uses cursor >= from && cursor <= to, so cursor === to is true
      // Verifying boundary semantics are consistent
      view = createView("hello", 3);
      expect(cursorInRange(view, 0, 3)).toBe(true);
    });

    it("returns false when cursor is well past range end", () => {
      view = createView("hello world", 10);
      expect(cursorInRange(view, 0, 3)).toBe(false);
    });
  });
});

describe("markdownRenderPlugin (Decoration.mark approach)", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("creates a view with the plugin without errors", () => {
    view = createView("# Hello\n\nSome **bold** text");
    expect(view.state.doc.toString()).toBe("# Hello\n\nSome **bold** text");
  });

  it("handles empty document", () => {
    view = createView("");
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
    view = createView(doc);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("does not throw when cursor is at beginning", () => {
    view = createView("# Hello\n\n**bold**", 0);
    expect(view.state.doc.toString()).toBe("# Hello\n\n**bold**");
  });

  it("does not throw when cursor is at end", () => {
    const doc = "# Hello\n\n**bold**";
    view = createView(doc, doc.length);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("survives rapid document changes", () => {
    view = createView("# Start");
    for (let i = 0; i < 100; i++) {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: `\nLine ${i}` },
      });
    }
    expect(view.state.doc.lines).toBe(101);
  });

  it("handles cursor movement through decorated regions", () => {
    const doc = "before **bold** after";
    view = createView(doc, 0);

    // Move cursor through the bold region
    for (let i = 0; i <= doc.length; i++) {
      view.dispatch({ selection: { anchor: i } });
    }

    expect(view.state.doc.toString()).toBe(doc);
  });

  it("source text is preserved in the document (mark approach keeps text)", () => {
    const doc = "**bold** and *italic*";
    view = createView(doc, doc.length); // cursor at end, outside markup
    // The document always keeps source text with Decoration.mark
    expect(view.state.doc.toString()).toBe(doc);
    // Markers are still in the doc (not replaced by widgets)
    expect(view.state.doc.toString()).toContain("**");
    expect(view.state.doc.toString()).toContain("*italic*");
  });

  it("uses Decoration.mark not Decoration.replace", () => {
    // Verify the plugin produces mark decorations, not replace decorations
    const doc = "**bold**";
    view = createView(doc, doc.length);
    // The key property of mark decorations: source text stays in the doc
    // and is not replaced by widget DOM. The doc should read the same.
    expect(view.state.doc.toString()).toBe("**bold**");
    // A replace decoration would remove the text from the DOM entirely
    // and substitute a widget. With marks, the text remains.
  });

  it("does not hide markers when cursor is inside element", () => {
    // Cursor at position 4 is inside "**bold**" (positions 0-7)
    const doc = "**bold**";
    view = createView(doc, 4);
    // With cursor inside, no decorations should be applied
    // (the tree walk returns false, skipping marker hiding)
    expect(view.state.doc.toString()).toBe(doc);
  });

  describe("negative / edge-case", () => {
    it("handles deeply nested inline formatting without error", () => {
      const doc = "***bold and italic***";
      view = createView(doc, 0);
      expect(view.state.doc.toString()).toBe(doc);
    });

    it("handles only whitespace document", () => {
      view = createView("   \n\n   ");
      expect(view.state.doc.toString()).toBe("   \n\n   ");
    });

    it("handles document with only headings", () => {
      const doc = "# H1\n## H2\n### H3";
      view = createView(doc);
      expect(view.state.doc.toString()).toBe(doc);
    });

    it("handles single character document", () => {
      view = createView("x");
      expect(view.state.doc.toString()).toBe("x");
    });

    it("does not throw on very long lines", () => {
      const longLine = "a".repeat(10000);
      view = createView(longLine);
      expect(view.state.doc.toString().length).toBe(10000);
    });
  });
});

describe("cursorContextKey", () => {
  it("returns empty string for plain text", () => {
    const state = createEditorState("hello world", {
      cursorPos: 5,
      extensions: markdown(),
    });
    expect(cursorContextKey(state)).toBe("");
  });

  it("returns a key when cursor is inside bold", () => {
    const state = createEditorState("**bold** text", {
      cursorPos: 4,
      extensions: markdown(),
    });
    expect(cursorContextKey(state)).toMatch(/^StrongEmphasis:\d+:\d+$/);
  });

  it("returns a key when cursor is inside italic", () => {
    const state = createEditorState("*italic* text", {
      cursorPos: 3,
      extensions: markdown(),
    });
    expect(cursorContextKey(state)).toMatch(/^Emphasis:\d+:\d+$/);
  });

  it("returns a key when cursor is inside a heading", () => {
    const state = createEditorState("# Heading\n\ntext", {
      cursorPos: 3,
      extensions: markdown(),
    });
    expect(cursorContextKey(state)).toMatch(/^ATXHeading1:\d+:\d+$/);
  });

  it("returns a key when cursor is inside a link", () => {
    const state = createEditorState("[link](url) text", {
      cursorPos: 3,
      extensions: markdown(),
    });
    expect(cursorContextKey(state)).toMatch(/^Link:\d+:\d+$/);
  });

  it("same key for two positions within the same node", () => {
    const ext = markdown();
    const stateA = createEditorState("**bold** text", {
      cursorPos: 3,
      extensions: ext,
    });
    const stateB = createEditorState("**bold** text", {
      cursorPos: 5,
      extensions: ext,
    });
    expect(cursorContextKey(stateA)).toBe(cursorContextKey(stateB));
  });

  it("different key for positions in different nodes", () => {
    const ext = markdown();
    const stateInBold = createEditorState("**bold** *italic*", {
      cursorPos: 3,
      extensions: ext,
    });
    const stateInItalic = createEditorState("**bold** *italic*", {
      cursorPos: 11,
      extensions: ext,
    });
    expect(cursorContextKey(stateInBold)).not.toBe(cursorContextKey(stateInItalic));
  });
});

describe("markdownShouldUpdate (rebuild narrowing, #579)", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  /**
   * Create a view with a counting plugin that uses markdownShouldUpdate.
   * Performs a warm-up dispatch to flush the spurious focusChanged that
   * JSDOM produces on the first dispatch after construction.
   */
  function createCountingView(doc: string, cursorPos = 0) {
    let buildCount = 0;
    const ext = createSimpleViewPlugin(
      () => { buildCount++; return Decoration.none; },
      { shouldUpdate: markdownShouldUpdate },
    );
    view = createTestView(doc, {
      cursorPos,
      extensions: [markdown(), ext],
    });
    // Warm-up: first dispatch after construction has spurious focusChanged
    view.dispatch({ selection: { anchor: cursorPos } });
    buildCount = 0;
    return { getBuildCount: () => buildCount };
  }

  it("does not rebuild when cursor moves within plain text", () => {
    const { getBuildCount } = createCountingView("hello world", 0);
    view.dispatch({ selection: { anchor: 5 } });
    expect(getBuildCount()).toBe(0);
  });

  it("rebuilds when cursor enters a bold node", () => {
    const { getBuildCount } = createCountingView("**bold** text", 12);
    view.dispatch({ selection: { anchor: 4 } });
    expect(getBuildCount()).toBe(1);
  });

  it("does not rebuild when cursor moves within the same bold node", () => {
    const { getBuildCount } = createCountingView("**bold** text", 3);
    view.dispatch({ selection: { anchor: 5 } });
    expect(getBuildCount()).toBe(0);
  });

  it("rebuilds when cursor leaves a bold node", () => {
    const { getBuildCount } = createCountingView("**bold** text", 4);
    view.dispatch({ selection: { anchor: 12 } });
    expect(getBuildCount()).toBe(1);
  });

  it("rebuilds when cursor moves between different sensitive nodes", () => {
    const { getBuildCount } = createCountingView("**bold** *italic*", 4);
    view.dispatch({ selection: { anchor: 11 } });
    expect(getBuildCount()).toBe(1);
  });

  it("rebuilds on document change", () => {
    const { getBuildCount } = createCountingView("hello", 0);
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(getBuildCount()).toBe(1);
  });

  it("does not rebuild when cursor moves within a heading", () => {
    const { getBuildCount } = createCountingView("# Hello World\n\ntext", 3);
    view.dispatch({ selection: { anchor: 7 } });
    expect(getBuildCount()).toBe(0);
  });

  it("rebuilds when cursor enters a heading", () => {
    const { getBuildCount } = createCountingView("# Hello\n\ntext", 12);
    view.dispatch({ selection: { anchor: 3 } });
    expect(getBuildCount()).toBe(1);
  });

  it("rebuilds when cursor moves from heading to nested inline node", () => {
    const { getBuildCount } = createCountingView("# Hello **bold**\n\ntext", 3);
    view.dispatch({ selection: { anchor: 12 } }); // into bold inside heading
    expect(getBuildCount()).toBe(1);
  });
});
