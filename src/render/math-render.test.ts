import { describe, expect, it, afterEach, vi } from "vitest";
import { CSS } from "../constants/css-classes";
import type { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { parser as lezerParser } from "@lezer/markdown";
import { MathWidget, collectMathRanges, stripMathDelimiters, getDisplayMathContentEnd } from "./math-render";
import { frontmatterField } from "../editor/frontmatter-state";
import { mathMacrosField } from "./math-macros";
import { createMockEditorView, createTestView } from "../test-utils";

/** Count only widget (replace) decorations, ignoring mark decorations like cf-math-source. */
function countWidgets(ranges: ReturnType<typeof collectMathRanges>): number {
  return ranges.filter(r => r.value.spec.widget).length;
}

/** Create an EditorView with math parser extensions at the given cursor position. */
function createMathView(doc: string, cursorPos?: number): EditorView {
  return createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: [mathExtension, equationLabelExtension] }),
      frontmatterField,
      mathMacrosField,
    ],
  });
}

/**
 * Create an EditorView with math + equation label extensions.
 *
 * focus: false mirrors the original createMathViewWithLabels behaviour which
 * did not call view.focus(). collectMathRanges() guards on view.hasFocus via
 * cursorInRange(), so an unfocused view always produces widget decorations
 * regardless of cursor position — which is what the equation-label tests need.
 */
function createMathViewWithLabels(doc: string, cursorPos?: number): EditorView {
  return createTestView(doc, {
    cursorPos,
    focus: false,
    extensions: [
      markdown({ extensions: [mathExtension, equationLabelExtension] }),
      frontmatterField,
      mathMacrosField,
    ],
  });
}

describe("MathWidget (inline)", () => {
  it("creates a span with cf-math-inline class", () => {
    const widget = new MathWidget("x^2", "$x^2$", false);
    const el = widget.toDOM();
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe(CSS.mathInline);
  });

  it("renders KaTeX content inside the span", () => {
    const widget = new MathWidget("x^2", "$x^2$", false);
    const el = widget.toDOM();
    expect(el.querySelector(".katex")).not.toBeNull();
  });

  it("shows error for invalid LaTeX", () => {
    const widget = new MathWidget("\\invalid{", "$\\invalid{$", false);
    const el = widget.toDOM();
    // throwOnError is false, so KaTeX handles errors gracefully
    // The element should still render without throwing
    expect(el.tagName).toBe("SPAN");
  });

  it("eq returns true for same raw content", () => {
    const a = new MathWidget("x^2", "$x^2$", false);
    const b = new MathWidget("x^2", "$x^2$", false);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different raw content", () => {
    const a = new MathWidget("x^2", "$x^2$", false);
    const b = new MathWidget("y^2", "$y^2$", false);
    expect(a.eq(b)).toBe(false);
  });

  it("eq distinguishes dollar and backslash syntax with same LaTeX", () => {
    const a = new MathWidget("x", "$x$", false);
    const b = new MathWidget("x", "\\(x\\)", false);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when isDisplay differs", () => {
    const a = new MathWidget("x", "$x$", false);
    const b = new MathWidget("x", "$x$", true);
    expect(a.eq(b)).toBe(false);
  });
});

describe("MathWidget (display)", () => {
  it("creates a div with cf-math-display class", () => {
    const widget = new MathWidget("x^2", "$$x^2$$", true);
    const el = widget.toDOM();
    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe(CSS.mathDisplay);
  });

  it("renders KaTeX content in display mode", () => {
    const widget = new MathWidget("x^2", "$$x^2$$", true);
    const el = widget.toDOM();
    expect(el.querySelector(".katex-display")).not.toBeNull();
  });

  it("wraps rendered display math in a shrink-wrapped content box", () => {
    const widget = new MathWidget("x^2", "$$x^2$$", true);
    const el = widget.toDOM();
    const content = el.querySelector(`.${CSS.mathDisplayContent}`);
    expect(content).not.toBeNull();
    expect((content as HTMLElement).classList.contains(CSS.mathDisplayContent)).toBe(true);
  });

  it("shows error for invalid LaTeX", () => {
    const widget = new MathWidget("\\bad{", "$$\\bad{$$", true);
    const el = widget.toDOM();
    expect(el.tagName).toBe("DIV");
  });

  it("eq returns true for same raw content", () => {
    const a = new MathWidget("x", "$$x$$", true);
    const b = new MathWidget("x", "$$x$$", true);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different raw content", () => {
    const a = new MathWidget("x", "$$x$$", true);
    const b = new MathWidget("y", "$$y$$", true);
    expect(a.eq(b)).toBe(false);
  });

  it("only reveals source when clicking the rendered display math content", () => {
    const focus = vi.fn();
    const dispatch = vi.fn();
    const view = createMockEditorView({ focus, dispatch });
    const widget = new MathWidget("x^2", "$$x^2$$", true);
    widget.sourceFrom = 8;
    widget.sourceTo = 15;

    const el = widget.toDOM(view);
    const content = el.querySelector<HTMLElement>(`.${CSS.mathDisplayContent}`);
    expect(content).not.toBeNull();

    content?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(focus).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      selection: { anchor: 8 },
      scrollIntoView: false,
    });
  });

  it("does not reveal source when clicking display-math row whitespace", () => {
    const focus = vi.fn();
    const dispatch = vi.fn();
    const view = createMockEditorView({ focus, dispatch });
    const widget = new MathWidget("x^2", "$$x^2$$", true);
    widget.sourceFrom = 8;
    widget.sourceTo = 15;

    const el = widget.toDOM(view);
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(focus).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("collectMathRanges", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("collects inline math with dollar syntax", () => {
    view = createMathView("text $x^2$ more", 0);
    const ranges = collectMathRanges(view);
    expect(ranges.length).toBe(1);
    expect(ranges[0].from).toBe(5);
    expect(ranges[0].to).toBe(10);
  });

  it("collects inline math with backslash-paren syntax", () => {
    view = createMathView("text \\(x^2\\) more", 0);
    const ranges = collectMathRanges(view);
    expect(ranges.length).toBe(1);
    expect(ranges[0].from).toBe(5);
    expect(ranges[0].to).toBe(12);
  });

  it("does not collect math when cursor is inside", () => {
    // Cursor at position 7 is inside "$x^2$" which spans 5..10
    view = createMathView("text $x^2$ more", 7);
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(0);
  });

  it("does not collect math when cursor is at math boundary", () => {
    // Cursor at position 5 is at the start of "$x^2$"
    view = createMathView("text $x^2$ more", 5);
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(0);
  });

  it("collects display math with dollar-dollar syntax", () => {
    const doc = "before\n\n$$x^2$$\n\nafter";
    view = createMathView(doc, doc.length);
    const ranges = collectMathRanges(view);
    expect(ranges.length).toBe(1);
  });

  it("collects display math with backslash-bracket syntax", () => {
    const doc = "before\n\n\\[x^2\\]\n\nafter";
    view = createMathView(doc, doc.length);
    const ranges = collectMathRanges(view);
    expect(ranges.length).toBe(1);
  });

  it("does not collect display math when cursor is inside", () => {
    const doc = "before\n\n$$x^2$$\n\nafter";
    // Cursor inside the $$ block
    view = createMathView(doc, 10);
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(0);
  });

  it("collects multiple math expressions", () => {
    const doc = "$a$ and $b$ and $c$ end";
    // Cursor at the very end, past the last math expression
    view = createMathView(doc, doc.length);
    const ranges = collectMathRanges(view);
    expect(ranges.length).toBe(3);
  });

  it("handles empty document", () => {
    view = createMathView("");
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(0);
  });

  it("handles document with no math", () => {
    view = createMathView("just plain text", 0);
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(0);
  });
});

describe("cursor toggle behavior", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("reveals source when cursor enters math region", () => {
    view = createMathView("text $x^2$ more", 0);
    // Initially cursor is outside, so math is collected for rendering
    let ranges = collectMathRanges(view);
    expect(ranges.length).toBe(1);

    // Move cursor inside the math
    view.dispatch({ selection: { anchor: 7 } });
    ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(0);
  });

  it("renders when cursor leaves math region", () => {
    view = createMathView("text $x^2$ more", 7);
    // Cursor inside math - no decorations
    let ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(0);

    // Move cursor outside
    view.dispatch({ selection: { anchor: 0 } });
    ranges = collectMathRanges(view);
    expect(ranges.length).toBe(1);
  });

  it("only reveals the math region containing the cursor", () => {
    view = createMathView("$a$ and $b$ and $c$", 9);
    // Cursor is inside $b$ (positions 8..10), so $a$ and $c$ should be collected
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(2);
  });
});

describe("error handling", () => {
  it("inline MathWidget does not throw on parse error", () => {
    const widget = new MathWidget("\\frac{", "$\\frac{$", false);
    expect(() => widget.toDOM()).not.toThrow();
  });

  it("display MathWidget does not throw on parse error", () => {
    const widget = new MathWidget("\\frac{", "$$\\frac{$$", true);
    expect(() => widget.toDOM()).not.toThrow();
  });

  it("handles deeply nested LaTeX without error", () => {
    const nested = "\\frac{\\frac{\\frac{1}{2}}{3}}{4}";
    const widget = new MathWidget(nested, `$${nested}$`, false);
    const el = widget.toDOM();
    expect(el.querySelector(".katex")).not.toBeNull();
  });
});

describe("performance", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("handles 100+ equations without error", () => {
    const equations = Array.from(
      { length: 120 },
      (_, i) => `$x_{${i}}^2$`,
    ).join(" ") + " end";
    view = createMathView(equations, equations.length);
    const ranges = collectMathRanges(view);
    expect(ranges.length).toBe(120);
  });

  it("processes many display math blocks", () => {
    const blocks = Array.from(
      { length: 50 },
      (_, i) => `$$\\sum_{k=0}^{${i}} k$$`,
    ).join("\n\n") + "\n\nend";
    view = createMathView(blocks, blocks.length);
    const ranges = collectMathRanges(view);
    expect(ranges.length).toBe(50);
  });
});

/** Extract the MathWidget from the first widget decoration in ranges (throws if none). */
function getFirstWidget(ranges: ReturnType<typeof collectMathRanges>): MathWidget {
  const widgetRange = ranges.find(r => r.value.spec.widget);
  if (!widgetRange) throw new Error("No widget decoration found");
  return widgetRange.value.spec.widget as MathWidget;
}

describe("stripMathDelimiters with contentTo", () => {
  it("strips $$ delimiters when contentTo slices at closing $$", () => {
    // "$$x^2$$ {#eq:foo}" — contentTo = 7 (end of closing $$)
    expect(stripMathDelimiters("$$x^2$$ {#eq:foo}", true, 7)).toBe("x^2");
  });

  it("strips \\[\\] delimiters when contentTo slices at closing \\]", () => {
    // "\\[x^2\\] {#eq:foo}" — contentTo = 7 (end of closing \])
    expect(stripMathDelimiters("\\[x^2\\] {#eq:foo}", true, 7)).toBe("x^2");
  });

  it("strips multi-line $$ delimiters with contentTo", () => {
    const raw = "$$\nx^2\n$$ {#eq:foo}";
    // contentTo = 9 (end of closing $$: "$$" at index 7-8, exclusive end = 9)
    expect(stripMathDelimiters(raw, true, 9)).toBe("\nx^2\n");
  });

  it("handles plain display math without contentTo", () => {
    expect(stripMathDelimiters("$$x^2$$", true)).toBe("x^2");
    expect(stripMathDelimiters("\\[x^2\\]", true)).toBe("x^2");
  });
});

describe("getDisplayMathContentEnd", () => {
  /** Parse text directly with Lezer and find the first DisplayMath SyntaxNode. */
  function findDisplayMathSyntaxNode(text: string) {
    const configured = lezerParser.configure([mathExtension, equationLabelExtension]);
    const tree = configured.parse(text);
    let found: import("@lezer/common").SyntaxNode | undefined;
    tree.iterate({
      enter(node) {
        if (node.name === "DisplayMath" && !found) {
          found = node.node;
          return false;
        }
      },
    });
    if (!found) throw new Error("DisplayMath node not found in parsed tree");
    return found;
  }

  it("returns offset for labeled $$ display math", () => {
    // "$$x^2$$ {#eq:foo}" — closing $$ ends at offset 7 from node start
    const node = findDisplayMathSyntaxNode("$$x^2$$ {#eq:foo}");
    expect(getDisplayMathContentEnd(node)).toBe(7);
  });

  it("returns offset for labeled \\[\\] display math", () => {
    const node = findDisplayMathSyntaxNode("\\[x^2\\] {#eq:foo}");
    expect(getDisplayMathContentEnd(node)).toBe(7);
  });

  it("returns undefined for unlabeled display math", () => {
    const node = findDisplayMathSyntaxNode("$$x^2$$");
    expect(getDisplayMathContentEnd(node)).toBeUndefined();
  });

  it("returns offset for multi-line labeled display math", () => {
    // "$$\nx^2\n$$ {#eq:bar}" — closing $$ starts at index 7, ends at 9
    const node = findDisplayMathSyntaxNode("$$\nx^2\n$$ {#eq:bar}");
    expect(getDisplayMathContentEnd(node)).toBe(9);
  });
});

describe("display math with equation labels", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("collects single-line display math with equation label", () => {
    const doc = "before\n\n$$x^2$$ {#eq:foo}\n\nafter";
    view = createMathViewWithLabels(doc, doc.length);
    const ranges = collectMathRanges(view);
    expect(ranges.length).toBe(1);
  });

  it("collects multi-line display math with equation label", () => {
    const doc = "before\n\n$$\nx^2\n$$ {#eq:bar}\n\nafter";
    view = createMathViewWithLabels(doc, doc.length);
    const ranges = collectMathRanges(view);
    expect(ranges.length).toBe(1);
  });

  it("collects display math without label when label extension is loaded", () => {
    const doc = "before\n\n$$x^2$$\n\nafter";
    view = createMathViewWithLabels(doc, doc.length);
    const ranges = collectMathRanges(view);
    expect(ranges.length).toBe(1);
  });

  it("inline math is unaffected by equation label extension", () => {
    const doc = "$x^2$ end";
    view = createMathViewWithLabels(doc, doc.length);
    const ranges = collectMathRanges(view);
    expect(ranges.length).toBe(1);
  });

  // Regression: labeled display math must produce a widget with the label
  // stripped from the LaTeX content. Previously, buildMathItems used
  // labelNode.from as contentTo, but whitespace between the closing
  // delimiter and the label caused stripMathDelimiters to fail to match
  // the closing delimiter (#334).
  it("widget contains LaTeX without label for $$ ... $$ {#eq:...}", () => {
    const doc = "$$x^2$$ {#eq:gaussian}";
    view = createMathViewWithLabels(doc, doc.length);
    const ranges = collectMathRanges(view);
    // The widget's DOM should contain rendered KaTeX, not the label text
    const el = getFirstWidget(ranges).toDOM();
    expect(el.querySelector(".katex-display")).not.toBeNull();
    expect(el.textContent).not.toContain("#eq:");
  });

  it("widget contains LaTeX without label for \\[...\\] {#eq:...}", () => {
    const doc = "\\[x^2\\] {#eq:binomial}";
    view = createMathViewWithLabels(doc, doc.length);
    const ranges = collectMathRanges(view);
    const el = getFirstWidget(ranges).toDOM();
    expect(el.querySelector(".katex-display")).not.toBeNull();
    expect(el.textContent).not.toContain("#eq:");
  });

  it("multi-line labeled $$ produces widget without label in LaTeX", () => {
    const doc = "$$\nx^2 + y^2\n$$ {#eq:circle}";
    view = createMathViewWithLabels(doc, doc.length);
    const ranges = collectMathRanges(view);
    const el = getFirstWidget(ranges).toDOM();
    expect(el.querySelector(".katex-display")).not.toBeNull();
    expect(el.textContent).not.toContain("#eq:");
  });

  it("unlabeled display math still renders correctly", () => {
    const doc = "$$x^2$$";
    view = createMathViewWithLabels(doc, doc.length);
    const ranges = collectMathRanges(view);
    const el = getFirstWidget(ranges).toDOM();
    expect(el.querySelector(".katex-display")).not.toBeNull();
  });
});
