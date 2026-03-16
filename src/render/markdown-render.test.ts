import { describe, expect, it, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { markdownRenderPlugin } from "./markdown-render";
import { cursorInRange } from "./render-utils";
import { HeadingWidget } from "./heading-render";
import { BoldWidget, ItalicWidget, InlineCodeWidget } from "./inline-render";
import { LinkWidget } from "./link-render";
import { ImageWidget } from "./image-render";
import { HorizontalRuleWidget } from "./hr-render";

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
  view.destroy = () => { origDestroy(); parent.remove(); };
  return view;
}

describe("cursorInRange", () => {
  it("returns true when cursor is inside the range", () => {
    const view = createTestView("hello world", 5);
    expect(cursorInRange(view, 0, 10)).toBe(true);
    view.destroy();
  });

  it("returns true when cursor is at range start", () => {
    const view = createTestView("hello world", 0);
    expect(cursorInRange(view, 0, 5)).toBe(true);
    view.destroy();
  });

  it("returns true when cursor is at range end", () => {
    const view = createTestView("hello world", 5);
    expect(cursorInRange(view, 0, 5)).toBe(true);
    view.destroy();
  });

  it("returns false when cursor is outside the range", () => {
    const view = createTestView("hello world", 8);
    expect(cursorInRange(view, 0, 5)).toBe(false);
    view.destroy();
  });
});

describe("HeadingWidget", () => {
  it("creates an h1 element", () => {
    const widget = new HeadingWidget("Test", 1);
    const el = widget.toDOM();
    expect(el.tagName).toBe("H1");
    expect(el.textContent).toBe("Test");
    expect(el.className).toBe("cg-heading");
  });

  it("creates an h3 element", () => {
    const widget = new HeadingWidget("Sub heading", 3);
    const el = widget.toDOM();
    expect(el.tagName).toBe("H3");
    expect(el.textContent).toBe("Sub heading");
  });

  it("eq returns true for same content", () => {
    const a = new HeadingWidget("Test", 1);
    const b = new HeadingWidget("Test", 1);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different content", () => {
    const a = new HeadingWidget("Test", 1);
    const b = new HeadingWidget("Other", 1);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false for different levels", () => {
    const a = new HeadingWidget("Test", 1);
    const b = new HeadingWidget("Test", 2);
    expect(a.eq(b)).toBe(false);
  });
});

describe("BoldWidget", () => {
  it("creates a strong element", () => {
    const widget = new BoldWidget("bold text");
    const el = widget.toDOM();
    expect(el.tagName).toBe("STRONG");
    expect(el.textContent).toBe("bold text");
    expect(el.className).toBe("cg-bold");
  });

  it("eq compares text", () => {
    expect(new BoldWidget("a").eq(new BoldWidget("a"))).toBe(true);
    expect(new BoldWidget("a").eq(new BoldWidget("b"))).toBe(false);
  });
});

describe("ItalicWidget", () => {
  it("creates an em element", () => {
    const widget = new ItalicWidget("italic text");
    const el = widget.toDOM();
    expect(el.tagName).toBe("EM");
    expect(el.textContent).toBe("italic text");
    expect(el.className).toBe("cg-italic");
  });

  it("eq compares text", () => {
    expect(new ItalicWidget("a").eq(new ItalicWidget("a"))).toBe(true);
    expect(new ItalicWidget("a").eq(new ItalicWidget("b"))).toBe(false);
  });
});

describe("InlineCodeWidget", () => {
  it("creates a code element", () => {
    const widget = new InlineCodeWidget("code()");
    const el = widget.toDOM();
    expect(el.tagName).toBe("CODE");
    expect(el.textContent).toBe("code()");
    expect(el.className).toBe("cg-inline-code");
  });

  it("eq compares text", () => {
    expect(new InlineCodeWidget("a").eq(new InlineCodeWidget("a"))).toBe(true);
    expect(new InlineCodeWidget("a").eq(new InlineCodeWidget("b"))).toBe(false);
  });
});

describe("LinkWidget", () => {
  it("creates an anchor element", () => {
    const widget = new LinkWidget("click me", "https://example.com");
    const el = widget.toDOM();
    expect(el.tagName).toBe("A");
    expect(el.textContent).toBe("click me");
    expect((el as HTMLAnchorElement).href).toBe("https://example.com/");
    expect(el.className).toBe("cg-link");
  });

  it("eq compares text and url", () => {
    const a = new LinkWidget("t", "u");
    expect(a.eq(new LinkWidget("t", "u"))).toBe(true);
    expect(a.eq(new LinkWidget("t", "v"))).toBe(false);
    expect(a.eq(new LinkWidget("s", "u"))).toBe(false);
  });
});

describe("ImageWidget", () => {
  it("creates a span with img element", () => {
    const widget = new ImageWidget("photo", "img.png");
    const el = widget.toDOM();
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe("cg-image-wrapper");
    const img = el.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.src).toContain("img.png");
    expect(img?.alt).toBe("photo");
  });

  it("eq compares alt and src", () => {
    const a = new ImageWidget("a", "b");
    expect(a.eq(new ImageWidget("a", "b"))).toBe(true);
    expect(a.eq(new ImageWidget("a", "c"))).toBe(false);
    expect(a.eq(new ImageWidget("d", "b"))).toBe(false);
  });
});

describe("HorizontalRuleWidget", () => {
  it("creates an hr element", () => {
    const widget = new HorizontalRuleWidget();
    const el = widget.toDOM();
    expect(el.tagName).toBe("HR");
    expect(el.className).toBe("cg-hr");
  });

  it("eq always returns true", () => {
    const a = new HorizontalRuleWidget();
    const b = new HorizontalRuleWidget();
    expect(a.eq(b)).toBe(true);
  });
});

describe("markdownRenderPlugin integration", () => {
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
});

