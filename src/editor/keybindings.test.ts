import { describe, expect, it, afterEach } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import type { EditorView } from "@codemirror/view";
import { markdownExtensions } from "../parser";
import { fenceProtectionExtension } from "../plugins/fence-protection";
import { createPluginRegistryField } from "../plugins/plugin-registry";
import { documentSemanticsField } from "../semantics/codemirror-source";
import {
  moveDownAcrossNestedClosingFences,
  toggleInlineMarker,
  toggleLink,
} from "./keybindings";
import { frontmatterField } from "./frontmatter-state";
import { createTestView, makeBlockPlugin } from "../test-utils";

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
  _to?: number,
  opts: { withMarkdown?: boolean } = {},
): EditorView {
  return createTestView(doc, {
    cursorPos: from,
    extensions: opts.withMarkdown ? [markdown()] : [],
  });
}

function makeFencedView(
  doc: string,
  cursorPos: number,
  plugins = [
    makeBlockPlugin({ name: "theorem" }),
    makeBlockPlugin({ name: "definition" }),
    makeBlockPlugin({ name: "proof" }),
  ],
): EditorView {
  return createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      frontmatterField,
      documentSemanticsField,
      createPluginRegistryField(plugins),
      fenceProtectionExtension,
    ],
  });
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

describe("moveDownAcrossNestedClosingFences", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("lands on the parent insertion point when nested closing fences are consecutive", () => {
    const doc = `:::: {.theorem}\nOuter intro\n\n::: {.proof}\nInner last line\n:::\n::::`;
    const innerLineEnd = doc.indexOf("Inner last line") + "Inner last line".length;
    view = makeFencedView(doc, innerLineEnd);

    expect(moveDownAcrossNestedClosingFences(view)).toBe(true);
    expect(view.state.selection.main.head).toBe(view.state.doc.line(7).from);
  });

  it("steps outward one structural level at a time across deeper consecutive closers", () => {
    const doc = `::::: {.theorem}\n:::: {.definition}\n::: {.proof}\nDeep\n:::\n::::\n:::::`;
    const deepLineEnd = doc.indexOf("Deep") + "Deep".length;
    view = makeFencedView(doc, deepLineEnd);

    expect(moveDownAcrossNestedClosingFences(view)).toBe(true);
    expect(view.state.selection.main.head).toBe(view.state.doc.line(6).from);

    expect(moveDownAcrossNestedClosingFences(view)).toBe(true);
    expect(view.state.selection.main.head).toBe(view.state.doc.line(7).from);
  });

  it("does not intercept when the parent still has visible content after the nested block", () => {
    const doc = `:::: {.theorem}\n::: {.proof}\nInner last line\n:::\nParent tail\n::::`;
    const innerLineEnd = doc.indexOf("Inner last line") + "Inner last line".length;
    view = makeFencedView(doc, innerLineEnd);

    expect(moveDownAcrossNestedClosingFences(view)).toBe(false);
    expect(view.state.selection.main.head).toBe(innerLineEnd);
  });
});

describe("toggleInlineMarker", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  describe("bold (**)", () => {
    it("wraps selected text with **", () => {
      view = makeView("hello world", 0, 5);
      view.dispatch({ selection: { anchor: 0, head: 5 } });
      toggleInlineMarker(view, "**");
      expect(view.state.doc.toString()).toBe("**hello** world");
      // Selection should cover the inner text
      expect(view.state.selection.main.from).toBe(2);
      expect(view.state.selection.main.to).toBe(7);
    });

    it("unwraps text already wrapped with ** (inside selection)", () => {
      view = makeView("**hello** world", 0, 9);
      view.dispatch({ selection: { anchor: 0, head: 9 } });
      toggleInlineMarker(view, "**");
      expect(view.state.doc.toString()).toBe("hello world");
      expect(view.state.selection.main.from).toBe(0);
      expect(view.state.selection.main.to).toBe(5);
    });

    it("unwraps when markers are outside the selection", () => {
      view = makeView("**hello** world", 2, 7);
      view.dispatch({ selection: { anchor: 2, head: 7 } });
      toggleInlineMarker(view, "**");
      expect(view.state.doc.toString()).toBe("hello world");
      expect(view.state.selection.main.from).toBe(0);
      expect(view.state.selection.main.to).toBe(5);
    });

    it("inserts empty markers and places cursor between them (no selection)", () => {
      view = makeView("hello", 5);
      toggleInlineMarker(view, "**");
      expect(view.state.doc.toString()).toBe("hello****");
      expect(view.state.selection.main.head).toBe(7);
    });

    it("removes markers when cursor is between them (no selection)", () => {
      view = makeView("hello****world", 7);
      toggleInlineMarker(view, "**");
      expect(view.state.doc.toString()).toBe("helloworld");
      expect(view.state.selection.main.head).toBe(5);
    });
  });

  describe("italic (*)", () => {
    it("wraps selected text with *", () => {
      view = makeView("hello world", 6, 11);
      view.dispatch({ selection: { anchor: 6, head: 11 } });
      toggleInlineMarker(view, "*");
      expect(view.state.doc.toString()).toBe("hello *world*");
      expect(view.state.selection.main.from).toBe(7);
      expect(view.state.selection.main.to).toBe(12);
    });

    it("unwraps text already wrapped with *", () => {
      view = makeView("*hello* world", 0, 7);
      view.dispatch({ selection: { anchor: 0, head: 7 } });
      toggleInlineMarker(view, "*");
      expect(view.state.doc.toString()).toBe("hello world");
    });
  });

  describe("inline code (`)", () => {
    it("wraps selected text with backticks", () => {
      view = makeView("run code now", 4, 8);
      view.dispatch({ selection: { anchor: 4, head: 8 } });
      toggleInlineMarker(view, "`");
      expect(view.state.doc.toString()).toBe("run `code` now");
    });

    it("unwraps backtick-wrapped text", () => {
      view = makeView("run `code` now", 4, 10);
      view.dispatch({ selection: { anchor: 4, head: 10 } });
      toggleInlineMarker(view, "`");
      expect(view.state.doc.toString()).toBe("run code now");
    });
  });

  describe("strikethrough (~~)", () => {
    it("wraps selected text with ~~", () => {
      view = makeView("deleted text", 0, 7);
      view.dispatch({ selection: { anchor: 0, head: 7 } });
      toggleInlineMarker(view, "~~");
      expect(view.state.doc.toString()).toBe("~~deleted~~ text");
    });

    it("unwraps ~~-wrapped text", () => {
      view = makeView("~~deleted~~ text", 0, 11);
      view.dispatch({ selection: { anchor: 0, head: 11 } });
      toggleInlineMarker(view, "~~");
      expect(view.state.doc.toString()).toBe("deleted text");
    });
  });

  describe("highlight (==)", () => {
    it("wraps selected text with ==", () => {
      view = makeView("important text", 0, 9);
      view.dispatch({ selection: { anchor: 0, head: 9 } });
      toggleInlineMarker(view, "==");
      expect(view.state.doc.toString()).toBe("==important== text");
    });

    it("unwraps ==-wrapped text", () => {
      view = makeView("==important== text", 0, 13);
      view.dispatch({ selection: { anchor: 0, head: 13 } });
      toggleInlineMarker(view, "==");
      expect(view.state.doc.toString()).toBe("important text");
    });
  });
});

describe("toggleLink", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("wraps selected text as a link", () => {
    view = makeView("click here please", 6, 10);
    view.dispatch({ selection: { anchor: 6, head: 10 } });
    toggleLink(view);
    expect(view.state.doc.toString()).toBe("click [here](url) please");
    // "url" should be selected
    expect(view.state.selection.main.from).toBe(13);
    expect(view.state.selection.main.to).toBe(16);
  });

  it("unwraps a selected link back to its text", () => {
    // Regression: full selection must use Lezer tree, not regex, so markdown
    // extension is required for the tree to contain a Link node.
    view = makeView("click [here](https://x.com) please", 6, 27, {
      withMarkdown: true,
    });
    view.dispatch({ selection: { anchor: 6, head: 27 } });
    toggleLink(view);
    expect(view.state.doc.toString()).toBe("click here please");
    expect(view.state.selection.main.from).toBe(6);
    expect(view.state.selection.main.to).toBe(10);
  });

  it("inserts empty link template with no selection", () => {
    view = makeView("text ", 5);
    toggleLink(view);
    expect(view.state.doc.toString()).toBe("text [](url)");
    // Cursor should be inside the brackets
    expect(view.state.selection.main.head).toBe(6);
  });

  it("unwraps when cursor/selection is inside a link text", () => {
    view = makeView("go [here](https://x.com) now", 4, 8, {
      withMarkdown: true,
    });
    view.dispatch({ selection: { anchor: 4, head: 8 } });
    toggleLink(view);
    expect(view.state.doc.toString()).toBe("go here now");
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
    view = makeView(doc, cursorPos, cursorPos, { withMarkdown: true });
    toggleLink(view);
    expect(view.state.doc.toString()).toBe("go here now");
  });

  it("unwraps when partial selection is inside link text", () => {
    // Regression: selecting only part of the link text (e.g. "er" inside
    // "[here](url)") should still detect the enclosing Link and unwrap it.
    const doc = "go [here](https://x.com) now";
    const from = doc.indexOf("er");
    const to = from + 2;
    view = makeView(doc, from, to, { withMarkdown: true });
    view.dispatch({ selection: { anchor: from, head: to } });
    toggleLink(view);
    expect(view.state.doc.toString()).toBe("go here now");
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
    view = makeView(doc, cursorPos, cursorPos, { withMarkdown: true });
    toggleLink(view);
    expect(view.state.doc.toString()).toBe("see this link for details");
  });
});
