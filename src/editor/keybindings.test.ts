import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { toggleInlineMarker, toggleLink } from "./keybindings";

/** Create a minimal EditorView with the given doc and selection. */
function makeView(doc: string, from: number, to?: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: from, head: to ?? from },
  });
  const parent = document.createElement("div");
  return new EditorView({ state, parent });
}

describe("toggleInlineMarker", () => {
  describe("bold (**)", () => {
    it("wraps selected text with **", () => {
      const view = makeView("hello world", 0, 5);
      toggleInlineMarker(view, "**");
      expect(view.state.doc.toString()).toBe("**hello** world");
      // Selection should cover the inner text
      expect(view.state.selection.main.from).toBe(2);
      expect(view.state.selection.main.to).toBe(7);
      view.destroy();
    });

    it("unwraps text already wrapped with ** (inside selection)", () => {
      const view = makeView("**hello** world", 0, 9);
      toggleInlineMarker(view, "**");
      expect(view.state.doc.toString()).toBe("hello world");
      expect(view.state.selection.main.from).toBe(0);
      expect(view.state.selection.main.to).toBe(5);
      view.destroy();
    });

    it("unwraps when markers are outside the selection", () => {
      const view = makeView("**hello** world", 2, 7);
      toggleInlineMarker(view, "**");
      expect(view.state.doc.toString()).toBe("hello world");
      expect(view.state.selection.main.from).toBe(0);
      expect(view.state.selection.main.to).toBe(5);
      view.destroy();
    });

    it("inserts empty markers and places cursor between them (no selection)", () => {
      const view = makeView("hello", 5);
      toggleInlineMarker(view, "**");
      expect(view.state.doc.toString()).toBe("hello****");
      expect(view.state.selection.main.head).toBe(7);
      view.destroy();
    });

    it("removes markers when cursor is between them (no selection)", () => {
      const view = makeView("hello****world", 7);
      toggleInlineMarker(view, "**");
      expect(view.state.doc.toString()).toBe("helloworld");
      expect(view.state.selection.main.head).toBe(5);
      view.destroy();
    });
  });

  describe("italic (*)", () => {
    it("wraps selected text with *", () => {
      const view = makeView("hello world", 6, 11);
      toggleInlineMarker(view, "*");
      expect(view.state.doc.toString()).toBe("hello *world*");
      expect(view.state.selection.main.from).toBe(7);
      expect(view.state.selection.main.to).toBe(12);
      view.destroy();
    });

    it("unwraps text already wrapped with *", () => {
      const view = makeView("*hello* world", 0, 7);
      toggleInlineMarker(view, "*");
      expect(view.state.doc.toString()).toBe("hello world");
      view.destroy();
    });
  });

  describe("inline code (`)", () => {
    it("wraps selected text with backticks", () => {
      const view = makeView("run code now", 4, 8);
      toggleInlineMarker(view, "`");
      expect(view.state.doc.toString()).toBe("run `code` now");
      view.destroy();
    });

    it("unwraps backtick-wrapped text", () => {
      const view = makeView("run `code` now", 4, 10);
      toggleInlineMarker(view, "`");
      expect(view.state.doc.toString()).toBe("run code now");
      view.destroy();
    });
  });

  describe("strikethrough (~~)", () => {
    it("wraps selected text with ~~", () => {
      const view = makeView("deleted text", 0, 7);
      toggleInlineMarker(view, "~~");
      expect(view.state.doc.toString()).toBe("~~deleted~~ text");
      view.destroy();
    });

    it("unwraps ~~-wrapped text", () => {
      const view = makeView("~~deleted~~ text", 0, 11);
      toggleInlineMarker(view, "~~");
      expect(view.state.doc.toString()).toBe("deleted text");
      view.destroy();
    });
  });

  describe("highlight (==)", () => {
    it("wraps selected text with ==", () => {
      const view = makeView("important text", 0, 9);
      toggleInlineMarker(view, "==");
      expect(view.state.doc.toString()).toBe("==important== text");
      view.destroy();
    });

    it("unwraps ==-wrapped text", () => {
      const view = makeView("==important== text", 0, 13);
      toggleInlineMarker(view, "==");
      expect(view.state.doc.toString()).toBe("important text");
      view.destroy();
    });
  });
});

describe("toggleLink", () => {
  it("wraps selected text as a link", () => {
    const view = makeView("click here please", 6, 10);
    toggleLink(view);
    expect(view.state.doc.toString()).toBe("click [here](url) please");
    // "url" should be selected
    expect(view.state.selection.main.from).toBe(13);
    expect(view.state.selection.main.to).toBe(16);
    view.destroy();
  });

  it("unwraps a selected link back to its text", () => {
    const view = makeView("click [here](https://x.com) please", 6, 27);
    toggleLink(view);
    expect(view.state.doc.toString()).toBe("click here please");
    expect(view.state.selection.main.from).toBe(6);
    expect(view.state.selection.main.to).toBe(10);
    view.destroy();
  });

  it("inserts empty link template with no selection", () => {
    const view = makeView("text ", 5);
    toggleLink(view);
    expect(view.state.doc.toString()).toBe("text [](url)");
    // Cursor should be inside the brackets
    expect(view.state.selection.main.head).toBe(6);
    view.destroy();
  });

  it("unwraps when cursor/selection is inside a link text", () => {
    const view = makeView("go [here](https://x.com) now", 4, 8);
    toggleLink(view);
    expect(view.state.doc.toString()).toBe("go here now");
    view.destroy();
  });
});
