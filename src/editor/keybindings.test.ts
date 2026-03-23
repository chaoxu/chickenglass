import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { toggleInlineMarker, toggleLink } from "./keybindings";

/**
 * Create a minimal EditorView with the given doc and selection.
 *
 * `withMarkdown` adds the @codemirror/lang-markdown extension so that
 * syntaxTree() in toggleLink() resolves Link nodes. Tests that exercise
 * Lezer-based link detection must pass `withMarkdown: true`.
 */
function makeView(
  doc: string,
  from: number,
  to?: number,
  opts: { withMarkdown?: boolean } = {},
): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: from, head: to ?? from },
    extensions: opts.withMarkdown ? [markdown()] : [],
  });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({ state, parent });
}

describe("edge cases", () => {
  it("does NOT wrap when no selection (cursor only inserts empty markers)", () => {
    // With no selection, toggleInlineMarker inserts an empty marker pair —
    // it does NOT wrap surrounding word content. The document content outside
    // the cursor position must be unchanged.
    const view = makeView("hello world", 5);
    toggleInlineMarker(view, "**");
    // The doc gains "****" at position 5, not a wrap around "hello"
    expect(view.state.doc.toString()).toBe("hello**** world");
    // Cursor is placed between the two markers
    expect(view.state.selection.main.head).toBe(7);
    view.destroy();
  });

  it("does NOT toggle formatting on empty document", () => {
    // An empty document must not throw; it should insert empty markers.
    const view = makeView("", 0);
    toggleInlineMarker(view, "**");
    expect(view.state.doc.toString()).toBe("****");
    expect(view.state.selection.main.head).toBe(2);
    view.destroy();
  });

  it("handles cursor at document boundary (position 0)", () => {
    // When the cursor is at position 0, the `before` check for the marker
    // reads from Math.max(0, 0 - mLen) = 0 which cannot match the marker;
    // a plain insert should happen without errors.
    const view = makeView("text", 0);
    toggleInlineMarker(view, "**");
    expect(view.state.doc.toString()).toBe("****text");
    expect(view.state.selection.main.head).toBe(2);
    view.destroy();
  });
});

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
    // Regression: full selection must use Lezer tree, not regex, so markdown
    // extension is required for the tree to contain a Link node.
    const view = makeView("click [here](https://x.com) please", 6, 27, {
      withMarkdown: true,
    });
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
    const view = makeView("go [here](https://x.com) now", 4, 8, {
      withMarkdown: true,
    });
    toggleLink(view);
    expect(view.state.doc.toString()).toBe("go here now");
    view.destroy();
  });

  // -------------------------------------------------------------------------
  // Regression tests for #350: Lezer-based link detection
  // -------------------------------------------------------------------------

  it("unwraps when cursor is in the middle of link text (not just after [)", () => {
    // Regression: old regex only detected when range.from - 1 === "[". With
    // the Lezer tree, any position inside the Link node triggers unwrap.
    // Cursor is placed mid-word in "here": go [he|re](https://x.com) now
    const doc = "go [here](https://x.com) now";
    const cursorPos = doc.indexOf("re"); // inside link text, not at its start
    const view = makeView(doc, cursorPos, cursorPos, { withMarkdown: true });
    toggleLink(view);
    expect(view.state.doc.toString()).toBe("go here now");
    view.destroy();
  });

  it("unwraps when partial selection is inside link text", () => {
    // Regression: selecting only part of the link text (e.g. "er" inside
    // "[here](url)") should still detect the enclosing Link and unwrap it.
    const doc = "go [here](https://x.com) now";
    const from = doc.indexOf("er");
    const to = from + 2;
    const view = makeView(doc, from, to, { withMarkdown: true });
    toggleLink(view);
    expect(view.state.doc.toString()).toBe("go here now");
    view.destroy();
  });

  it("unwraps links with URLs longer than 50 characters", () => {
    // Regression: old code used `range.to + 50` as a lookahead limit, so
    // links with URLs > 50 chars were not detected. The Lezer tree has no
    // such limit.
    const longUrl =
      "https://example.com/very/long/path/that/exceeds/fifty/characters/total";
    const doc = `see [this link](${longUrl}) for details`;
    // Cursor inside link text
    const cursorPos = doc.indexOf("this");
    const view = makeView(doc, cursorPos, cursorPos, { withMarkdown: true });
    toggleLink(view);
    expect(view.state.doc.toString()).toBe("see this link for details");
    view.destroy();
  });
});
