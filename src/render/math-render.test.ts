import { describe, expect, it, afterEach, vi } from "vitest";
import katex from "katex";
import { CSS } from "../constants/css-classes";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { parser as lezerParser } from "@lezer/markdown";
import { MathWidget, collectMathRanges, stripMathDelimiters, getDisplayMathContentEnd, _mathDecorationFieldForTest as mathDecorationField, mathRenderPlugin, clearKatexCache, renderKatex, renderKatexToHtml } from "./math-render";
import { frontmatterField } from "../editor/frontmatter-state";
import { mathMacrosField } from "./math-macros";
import { createMockEditorView, createTestView } from "../test-utils";
import { focusEffect, widgetSourceMap } from "./render-utils";
import { documentSemanticsField } from "../semantics/codemirror-source";
import { renderInlineMarkdown } from "./inline-render";

/** Count only widget (replace) decorations, ignoring mark decorations like cf-math-source. */
function countWidgets(ranges: ReturnType<typeof collectMathRanges>): number {
  return ranges.filter(r => r.value.spec.widget).length;
}

function countSourceMarks(ranges: ReturnType<typeof collectMathRanges>): number {
  return ranges.filter((r) => r.value.spec.class === CSS.mathSource).length;
}

/** Create an EditorView with math parser extensions at the given cursor position. */
function createMathView(doc: string, cursorPos?: number): EditorView {
  return createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: [mathExtension, equationLabelExtension] }),
      frontmatterField,
      documentSemanticsField,
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
      documentSemanticsField,
      mathMacrosField,
    ],
  });
}

function createMathRenderState(doc: string, cursorPos = 0): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions: [
      markdown({ extensions: [mathExtension, equationLabelExtension] }),
      frontmatterField,
      documentSemanticsField,
      mathRenderPlugin,
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

  it("click dispatches to updated position after updateSourceRange (position mapping)", () => {
    const focus = vi.fn();
    const dispatch = vi.fn();
    const view = createMockEditorView({ focus, dispatch });
    const widget = new MathWidget("x^2", "$x^2$", false);
    widget.sourceFrom = 410;
    widget.sourceTo = 415;

    const el = widget.toDOM(view);
    widget.updateSourceRange(411, 416);

    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(dispatch).toHaveBeenCalledWith({
      selection: { anchor: 411 },
      scrollIntoView: false,
    });
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

  it("re-attaches display-math click handlers when the DOM is cloned from cache", () => {
    const focus = vi.fn();
    const dispatch = vi.fn();
    const view = createMockEditorView({ focus, dispatch });
    const widget = new MathWidget("x^2", "$$x^2$$", true);
    widget.sourceFrom = 8;
    widget.sourceTo = 15;

    widget.toDOM(view);
    const cloned = widget.toDOM(view);
    const content = cloned.querySelector<HTMLElement>(`.${CSS.mathDisplayContent}`);

    content?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(focus).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      selection: { anchor: 8 },
      scrollIntoView: false,
    });
  });

  it("click dispatches to updated position after updateSourceRange (position mapping)", () => {
    const focus = vi.fn();
    const dispatch = vi.fn();
    const view = createMockEditorView({ focus, dispatch });
    const widget = new MathWidget("x^2", "$$x^2$$", true);
    widget.sourceFrom = 950;
    widget.sourceTo = 1022;

    const el = widget.toDOM(view);
    // Simulate position mapping: an insert before the widget shifted it by 1
    widget.updateSourceRange(951, 1023);

    const content = el.querySelector<HTMLElement>(`.${CSS.mathDisplayContent}`);
    content?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(dispatch).toHaveBeenCalledWith({
      selection: { anchor: 951 },
      scrollIntoView: false,
    });
  });

  it("widgetSourceMap returns updated positions after updateSourceRange", () => {
    const widget = new MathWidget("x^2", "$$x^2$$", true);
    widget.sourceFrom = 950;
    widget.sourceTo = 1022;

    const el = widget.toDOM();
    // After toDOM, widgetSourceMap should point el → widget
    expect(widgetSourceMap.get(el)).toBe(widget);
    expect(widgetSourceMap.get(el)!.sourceFrom).toBe(950);

    // Simulate position mapping
    widget.updateSourceRange(951, 1023);

    // widgetSourceMap still points to the same widget, now with updated fields
    expect(widgetSourceMap.get(el)!.sourceFrom).toBe(951);
    expect(widgetSourceMap.get(el)!.sourceTo).toBe(1023);
  });
});

describe("MathWidget.updateDOM", () => {
  it("updates inline math content and refreshes source-range metadata", () => {
    const oldWidget = new MathWidget("x^2", "$x^2$", false);
    oldWidget.sourceFrom = 10;
    oldWidget.sourceTo = 15;
    const dom = oldWidget.toDOM();

    expect(widgetSourceMap.get(dom)).toBe(oldWidget);
    expect(dom.dataset.sourceFrom).toBe("10");
    expect(dom.dataset.sourceTo).toBe("15");
    expect(dom.getAttribute("aria-label")).toBe("x^2");

    const newWidget = new MathWidget("y^2", "$y^2$", false);
    newWidget.sourceFrom = 20;
    newWidget.sourceTo = 25;

    const result = newWidget.updateDOM(dom);
    expect(result).toBe(true);

    // Source-range metadata must be refreshed (reviewer #732 blocking issue)
    expect(widgetSourceMap.get(dom)).toBe(newWidget);
    expect(widgetSourceMap.get(dom)!.sourceFrom).toBe(20);
    expect(widgetSourceMap.get(dom)!.sourceTo).toBe(25);
    expect(dom.dataset.sourceFrom).toBe("20");
    expect(dom.dataset.sourceTo).toBe("25");

    // Content must be updated
    expect(dom.getAttribute("aria-label")).toBe("y^2");
    expect(dom.querySelector(".katex")).not.toBeNull();
  });

  it("updates display math content and refreshes source-range metadata", () => {
    const oldWidget = new MathWidget("x^2", "$$x^2$$", true);
    oldWidget.sourceFrom = 100;
    oldWidget.sourceTo = 107;
    const dom = oldWidget.toDOM();

    expect(widgetSourceMap.get(dom)).toBe(oldWidget);
    expect(dom.dataset.sourceFrom).toBe("100");

    const newWidget = new MathWidget("y^2", "$$y^2$$", true);
    newWidget.sourceFrom = 110;
    newWidget.sourceTo = 117;

    const result = newWidget.updateDOM(dom);
    expect(result).toBe(true);

    expect(widgetSourceMap.get(dom)).toBe(newWidget);
    expect(widgetSourceMap.get(dom)!.sourceFrom).toBe(110);
    expect(dom.dataset.sourceFrom).toBe("110");
    expect(dom.dataset.sourceTo).toBe("117");
    expect(dom.getAttribute("aria-label")).toBe("y^2");
    expect(dom.querySelector(".katex-display")).not.toBeNull();
  });

  it("preserves DOM node identity (no destroy/recreate)", () => {
    const oldWidget = new MathWidget("a", "$a$", false);
    oldWidget.sourceFrom = 0;
    oldWidget.sourceTo = 3;
    const dom = oldWidget.toDOM();
    const domRef = dom;

    const newWidget = new MathWidget("b", "$b$", false);
    newWidget.sourceFrom = 0;
    newWidget.sourceTo = 3;
    newWidget.updateDOM(dom);

    // Same DOM element, not a new one
    expect(dom).toBe(domRef);
  });

  it("returns false when tag structure mismatches (inline vs display)", () => {
    const oldWidget = new MathWidget("x", "$x$", false);
    const dom = oldWidget.toDOM(); // span

    const newWidget = new MathWidget("x", "$$x$$", true);
    expect(newWidget.updateDOM(dom)).toBe(false);
  });
});

describe("collectMathRanges", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
    clearKatexCache();
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

  it("keeps rendered display math visible when cursor is inside", () => {
    const doc = "before\n\n$$x^2$$\n\nafter";
    // Cursor inside the $$ block
    view = createMathView(doc, 10);
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(1);
    expect(countSourceMarks(ranges)).toBeGreaterThan(0);
  });

  it("keeps rendered labeled display math visible when cursor is inside", () => {
    const doc = "before\n\n$$\nx^2\n$$ {#eq:test}\n\nafter";
    view = createMathView(doc, 11);
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(1);
    expect(countSourceMarks(ranges)).toBeGreaterThan(1);
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

describe("math decoration invalidation", () => {
  it("does not rebuild when unrelated semantics change outside the math slice", () => {
    const doc = "$x$\n\n# Old";
    const state = createMathRenderState(doc);
    const before = state.field(mathDecorationField);
    const headingText = doc.indexOf("Old");

    const after = state.update({
      changes: {
        from: headingText,
        to: headingText + 3,
        insert: "New",
      },
    }).state.field(mathDecorationField);

    expect(after).toBe(before);
  });

  it("does not rebuild when frontmatter changes but math macros stay the same", () => {
    const doc = [
      "---",
      "title: Old",
      "math:",
      "  \\R: alpha",
      "---",
      "",
      "$\\R$",
    ].join("\n");
    const state = createMathRenderState(doc);
    const before = state.field(mathDecorationField);
    const titleText = doc.indexOf("Old");

    const after = state.update({
      changes: {
        from: titleText,
        to: titleText + 3,
        insert: "New",
      },
    }).state.field(mathDecorationField);

    // Math is after the edit so positions shift — the decoration set is
    // position-mapped (not rebuilt from scratch), producing a new object
    // with the same number of decorations.
    expect(after.size).toBe(before.size);
  });

  it("rebuilds when math content changes", () => {
    const doc = "aa $x$ bb";
    const state = createMathRenderState(doc);
    const before = state.field(mathDecorationField);
    const mathText = doc.indexOf("x");

    const after = state.update({
      changes: {
        from: mathText,
        to: mathText + 1,
        insert: "y",
      },
    }).state.field(mathDecorationField);

    expect(after).not.toBe(before);
  });

  it("rebuilds when editing first math also shifts later math positions", () => {
    const doc = "$x$ and $y$";
    const state = createMathRenderState(doc);
    const before = state.field(mathDecorationField);
    const mathText = doc.indexOf("x");

    const after = state.update({
      changes: {
        from: mathText,
        to: mathText + 1,
        insert: "ab",
      },
    }).state.field(mathDecorationField);

    // Full rebuild because first math region's content changed,
    // even though the second only had a position shift.
    expect(after).not.toBe(before);
  });

  it("rebuilds when math macros change", () => {
    const doc = [
      "---",
      "title: Old",
      "math:",
      "  \\R: alpha",
      "---",
      "",
      "$\\R$",
    ].join("\n");
    const state = createMathRenderState(doc);
    const before = state.field(mathDecorationField);
    const macroValue = doc.indexOf("alpha");

    const after = state.update({
      changes: {
        from: macroValue,
        to: macroValue + 5,
        insert: "omega",
      },
    }).state.field(mathDecorationField);

    expect(after).not.toBe(before);
  });

  it("does not rebuild when selection moves outside all math regions", () => {
    const doc = "aa $x$ bb $$y$$ cc";
    const state = createMathRenderState(doc);

    const before = state.field(mathDecorationField);
    const after = state.update({ selection: { anchor: 1 } }).state.field(mathDecorationField);

    expect(after).toBe(before);
  });

  it("rebuilds when focused selection enters a math region", () => {
    const doc = "aa $x$ bb";
    const initial = createMathRenderState(doc);
    const focused = initial.update({ effects: focusEffect.of(true) }).state;
    const before = focused.field(mathDecorationField);
    const insideMath = doc.indexOf("$x$") + 1;

    const after = focused.update({ selection: { anchor: insideMath } }).state.field(mathDecorationField);

    expect(after).not.toBe(before);
  });

  it("does not rebuild on focus gain when the cursor stays outside math", () => {
    const doc = "aa $x$ bb";
    const state = createMathRenderState(doc);
    const before = state.field(mathDecorationField);

    const after = state.update({ effects: focusEffect.of(true) }).state.field(mathDecorationField);

    expect(after).toBe(before);
  });

  it("rebuilds on focus gain when the cursor is already inside math", () => {
    const doc = "aa $x$ bb";
    const insideMath = doc.indexOf("$x$") + 1;
    const state = createMathRenderState(doc, insideMath);
    const before = state.field(mathDecorationField);

    const after = state.update({ effects: focusEffect.of(true) }).state.field(mathDecorationField);

    expect(after).not.toBe(before);
  });

  it("maps decorations instead of rebuilding when prose before math is edited", () => {
    const doc = "hello $x$ end";
    const state = createMathRenderState(doc, 0);
    const before = state.field(mathDecorationField);

    // Insert text before the math expression — only positions shift
    const after = state.update({
      changes: { from: 0, to: 0, insert: "a" },
    }).state.field(mathDecorationField);

    // Mapped (not identity-preserved) since positions shifted,
    // but same number of decorations (not rebuilt from scratch).
    expect(after).not.toBe(before);
    expect(after.size).toBe(before.size);
  });

  it("updates sourceFrom/sourceTo on mapped widgets after position-only edit", () => {
    const doc = "hello $x$ end";
    const state = createMathRenderState(doc, 0);

    // Math "$x$" starts at index 6 in the original document
    const originalMathFrom = doc.indexOf("$x$");
    expect(originalMathFrom).toBe(6);

    // Insert "abc" at the start — math shifts by 3
    const after = state.update({
      changes: { from: 0, to: 0, insert: "abc" },
    }).state.field(mathDecorationField);

    // Extract widget sourceFrom from the mapped decoration set
    const cursor = after.iter();
    expect(cursor.value).not.toBeNull();
    const widget = cursor.value!.spec?.widget as MathWidget | undefined;
    expect(widget).toBeInstanceOf(MathWidget);
    // sourceFrom must reflect the new position (6 + 3 = 9), not the stale 6
    expect(widget!.sourceFrom).toBe(originalMathFrom + 3);
    expect(widget!.sourceTo).toBe(originalMathFrom + 3 + "$x$".length);
  });
});

describe("cursor toggle behavior", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
    clearKatexCache();
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
    clearKatexCache();
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

describe("shared KaTeX HTML cache", () => {
  afterEach(() => {
    clearKatexCache();
    vi.restoreAllMocks();
  });

  it("reuses cached KaTeX HTML across widget and inline renderers", () => {
    renderKatexToHtml("x^2", false, {});
    vi.spyOn(katex, "renderToString").mockImplementation(() => {
      throw new Error("cache miss");
    });

    const widgetContainer = document.createElement("div");
    renderKatex(widgetContainer, "x^2", false, {});

    const inlineContainer = document.createElement("div");
    renderInlineMarkdown(inlineContainer, "$x^2$");

    expect(widgetContainer.querySelector(".katex")).not.toBeNull();
    expect(inlineContainer.querySelector(".katex")).not.toBeNull();
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
    clearKatexCache();
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
