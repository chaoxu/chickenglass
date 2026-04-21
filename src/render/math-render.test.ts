import { describe, expect, it, afterEach, vi } from "vitest";
import katex from "katex";
import { CSS } from "../constants/css-classes";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { parser as lezerParser } from "@lezer/markdown";
import { MathWidget, collectMathRanges, stripMathDelimiters, getDisplayMathContentEnd, _mathDecorationFieldForTest as mathDecorationField, mathRenderPlugin, clearKatexCache, renderKatex, renderKatexToHtml, _snapToTokenBoundary } from "./math-render";
import { frontmatterField } from "../editor/frontmatter-state";
import { mathMacrosField } from "../state/math-macros";
import { createMockEditorView, createTestView, getDecorationSpecs } from "../test-utils";
import { focusEffect, widgetSourceMap } from "./render-utils";
import { documentSemanticsField } from "../state/document-analysis";
import { renderInlineMarkdown } from "./inline-render";
import {
  activeStructureEditField,
  createStructureEditTargetAt,
  setStructureEditTargetEffect,
} from "../state/cm-structure-edit";
import { setInlineMathViewportRangesEffect } from "./math-inline-viewport";

/** Count only widget (replace) decorations, ignoring mark decorations like cf-math-source. */
function countWidgets(ranges: ReturnType<typeof collectMathRanges>): number {
  return ranges.filter(r => r.value.spec.widget).length;
}

function countSourceMarks(ranges: ReturnType<typeof collectMathRanges>): number {
  return ranges.filter((r) => r.value.spec.class === CSS.mathSource).length;
}

function countMarksWithClass(
  ranges: ReturnType<typeof collectMathRanges>,
  className: string,
): number {
  return ranges.filter((r) => r.value.spec.class === className).length;
}

/** Create an EditorView with math parser extensions at the given cursor position. */
function createMathView(doc: string, cursorPos?: number): EditorView {
  return createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: [mathExtension, equationLabelExtension] }),
      frontmatterField,
      activeStructureEditField,
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
      activeStructureEditField,
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
      activeStructureEditField,
      documentSemanticsField,
      mathRenderPlugin,
    ],
  });
}

function createMathRenderView(doc: string, cursorPos = 0): EditorView {
  const view = createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: [mathExtension, equationLabelExtension] }),
      frontmatterField,
      activeStructureEditField,
      documentSemanticsField,
      mathRenderPlugin,
    ],
  });
  view.dispatch({ effects: focusEffect.of(true) });
  return view;
}

function activateDisplayMathSourceView(view: EditorView, pos: number): void {
  const target = createStructureEditTargetAt(view.state, pos);
  expect(target?.kind).toBe("display-math");
  if (!target) throw new Error("expected display-math structure-edit target");
  view.dispatch({
    effects: setStructureEditTargetEffect.of(target),
    selection: { anchor: pos },
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

  it("includes relative source-location attributes in cached KaTeX HTML", () => {
    const html = renderKatexToHtml("x^2+y^2", false, {});
    expect(html).toContain("data-loc-start");
    expect(html).toContain("data-loc-end");
  });

  it("KaTeX output contains data-loc-start on grouped expressions", () => {
    const el = document.createElement("span");
    renderKatex(el, "\\frac{a}{b}+c", false, {});
    const locEls = el.querySelectorAll("[data-loc-start]");
    expect(locEls.length).toBeGreaterThan(0);
  });

  it("KaTeX output contains data-loc-start for display math", () => {
    const el = document.createElement("div");
    renderKatex(el, "\\sum_{i=1}^{n} x_i", true, {});
    const locEls = el.querySelectorAll("[data-loc-start]");
    expect(locEls.length).toBeGreaterThan(0);
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

    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(dispatch).toHaveBeenCalledWith({
      selection: { anchor: 411 },
      scrollIntoView: false,
    });
  });

  it("does not reveal inline source on mousedown before a drag gesture is established", () => {
    const focus = vi.fn();
    const dispatch = vi.fn();
    const view = createMockEditorView({ focus, dispatch });
    const widget = new MathWidget("x^2", "$x^2$", false);
    widget.sourceFrom = 20;
    widget.sourceTo = 25;

    const el = widget.toDOM(view);
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(focus).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
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

  it("renders an equation number when provided", () => {
    const widget = new MathWidget("x^2", "$$x^2$$", true, {}, 0, 7);
    const el = widget.toDOM();
    expect(el.classList.contains(CSS.mathDisplayNumbered)).toBe(true);
    expect(el.querySelector(`.${CSS.mathDisplayNumber}`)?.textContent).toBe("(7)");
  });

  it("does not apply numbered layout classes to unlabeled display math", () => {
    const widget = new MathWidget("x^2", "$$x^2$$", true);
    const el = widget.toDOM();
    expect(el.classList.contains(CSS.mathDisplayNumbered)).toBe(false);
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

  it("eq returns false when equation numbers differ", () => {
    const a = new MathWidget("x", "$$x$$", true, {}, 0, 1);
    const b = new MathWidget("x", "$$x$$", true, {}, 0, 2);
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

  it("maps nested KaTeX clicks to content-relative source positions", () => {
    const focus = vi.fn();
    const dispatch = vi.fn();
    const view = createMockEditorView({ focus, dispatch });
    const widget = new MathWidget("x^2+y^2", "$$x^2+y^2$$", true, {}, 2);
    widget.sourceFrom = 100;
    widget.sourceTo = 111;

    const el = widget.toDOM(view);
    // Verify KaTeX emitted data-loc-start on at least some nodes
    const locEls = el.querySelectorAll<HTMLElement>("[data-loc-start]");
    expect(locEls.length).toBeGreaterThan(0);

    // In JSDOM, getBoundingClientRect returns zeros so findLocAtPoint
    // falls through to the proportional fallback.  Dispatching a click
    // should still set the cursor within the source range.
    const content = el.querySelector<HTMLElement>(`.${CSS.mathDisplayContent}`);
    content?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(dispatch).toHaveBeenCalled();
    const call = dispatch.mock.calls[0][0];
    expect(call.selection.anchor).toBeGreaterThanOrEqual(100);
    expect(call.selection.anchor).toBeLessThanOrEqual(111);
  });

  it("widgetSourceMap returns updated positions after updateSourceRange", () => {
    const widget = new MathWidget("x^2", "$$x^2$$", true);
    widget.sourceFrom = 950;
    widget.sourceTo = 1022;

    const el = widget.toDOM();
    // After toDOM, widgetSourceMap should point el → widget
    const mappedWidget = widgetSourceMap.get(el);
    expect(mappedWidget).toBe(widget);
    expect(mappedWidget?.sourceFrom).toBe(950);

    // Simulate position mapping
    widget.updateSourceRange(951, 1023);

    // widgetSourceMap still points to the same widget, now with updated fields
    const updatedMappedWidget = widgetSourceMap.get(el);
    expect(updatedMappedWidget?.sourceFrom).toBe(951);
    expect(updatedMappedWidget?.sourceTo).toBe(1023);
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
    const updatedInlineWidget = widgetSourceMap.get(dom);
    expect(updatedInlineWidget).toBe(newWidget);
    expect(updatedInlineWidget?.sourceFrom).toBe(20);
    expect(updatedInlineWidget?.sourceTo).toBe(25);
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

    const updatedDisplayWidget = widgetSourceMap.get(dom);
    expect(updatedDisplayWidget).toBe(newWidget);
    expect(updatedDisplayWidget?.sourceFrom).toBe(110);
    expect(dom.dataset.sourceFrom).toBe("110");
    expect(dom.dataset.sourceTo).toBe("117");
    expect(dom.getAttribute("aria-label")).toBe("y^2");
    expect(dom.querySelector(".katex-display")).not.toBeNull();
  });

  it("updates display math equation numbers without rebuilding the DOM node", () => {
    const oldWidget = new MathWidget("x^2", "$$x^2$$", true, {}, 0, 1);
    const dom = oldWidget.toDOM();

    const newWidget = new MathWidget("x^2", "$$x^2$$", true, {}, 0, 2);
    const result = newWidget.updateDOM(dom);

    expect(result).toBe(true);
    expect(dom.querySelector(`.${CSS.mathDisplayNumber}`)?.textContent).toBe("(2)");
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

  it("reveals inline source when the focused cursor touches inline math", () => {
    view = createMathView("text $x^2$ more", 7);
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(0);
    expect(countMarksWithClass(ranges, CSS.sourceDelimiter)).toBe(2);
    expect(countMarksWithClass(ranges, CSS.mathSource)).toBe(1);
  });

  it("reveals inline source when the focused selection touches inline math", () => {
    view = createMathView("text $x^2$ more", 0);
    view.dispatch({
      selection: {
        anchor: 6,
        head: 9,
      },
    });
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(0);
    expect(countMarksWithClass(ranges, CSS.sourceDelimiter)).toBe(2);
    expect(countMarksWithClass(ranges, CSS.mathSource)).toBe(1);
  });

  it("keeps inline math rendered when unfocused even if the cursor is inside", () => {
    view = createMathViewWithLabels("text $x^2$ more", 7);
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(1);
  });

  it("reveals inline source when the focused cursor touches inline math", () => {
    view = createMathView("text $x^2$ more", 0);
    view.dispatch({ selection: { anchor: 7 } });
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(0);
  });

  it("reveals inline source when the focused cursor starts at the math boundary", () => {
    view = createMathView("text $x^2$ more", 0);
    view.dispatch({ selection: { anchor: 5 } });
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(0);
  });

  it("styles inline $ delimiters with cf-source-delimiter during focused cursor reveal (#789)", () => {
    view = createMathView("text $x^2$ more", 0);
    view.dispatch({ selection: { anchor: 7 } });
    const ranges = collectMathRanges(view);
    expect(countMarksWithClass(ranges, CSS.sourceDelimiter)).toBe(2);
    expect(countMarksWithClass(ranges, CSS.mathSource)).toBe(1);
  });

  it("styles inline \\( \\) delimiters with cf-source-delimiter during focused cursor reveal (#789)", () => {
    view = createMathView("text \\(x^2\\) more", 0);
    view.dispatch({ selection: { anchor: 8 } });
    const ranges = collectMathRanges(view);
    expect(countMarksWithClass(ranges, CSS.sourceDelimiter)).toBe(2);
    expect(countMarksWithClass(ranges, CSS.mathSource)).toBe(1);
  });

  it("collects display math with dollar-dollar syntax", () => {
    const doc = "before\n\n$$x^2$$\n\nafter";
    view = createMathView(doc, doc.length);
    const ranges = collectMathRanges(view);
    expect(ranges.length).toBe(1);
  });

  it("renders non-active display math as a block replacement", () => {
    const state = createMathRenderState("before\n\n$$x^2$$\n\nafter");
    const specs = getDecorationSpecs(state.field(mathDecorationField));
    const displayWidget = specs.find((spec) => spec.widgetClass === "MathWidget");
    expect(displayWidget?.block).toBe(true);
    expect(displayWidget?.from).toBeLessThan(displayWidget?.to ?? 0);
  });

  it("collects display math with backslash-bracket syntax", () => {
    const doc = "before\n\n\\[x^2\\]\n\nafter";
    view = createMathView(doc, doc.length);
    const ranges = collectMathRanges(view);
    expect(ranges.length).toBe(1);
  });

  it("keeps rendered display math visible when structure edit is active", () => {
    const doc = "before\n\n$$x^2$$\n\nafter";
    view = createMathView(doc, 0);
    activateDisplayMathSourceView(view, 10);
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(1);
    expect(countSourceMarks(ranges)).toBeGreaterThan(0);
  });

  it("keeps rendered labeled display math visible when structure edit is active", () => {
    const doc = "before\n\n$$\nx^2\n$$ {#eq:test}\n\nafter";
    view = createMathView(doc, 0);
    activateDisplayMathSourceView(view, 11);
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(1);
    expect(countSourceMarks(ranges)).toBeGreaterThan(1);
  });

  it("keeps display-math label/body on cf-math-source but delimiters on cf-source-delimiter during structure edit (#789)", () => {
    const doc = "before\n\n$$\nx^2\n$$ {#eq:test}\n\nafter";
    view = createMathView(doc, 0);
    activateDisplayMathSourceView(view, 11);
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(1);
    expect(countMarksWithClass(ranges, CSS.sourceDelimiter)).toBe(2);
    expect(countMarksWithClass(ranges, CSS.mathSource)).toBe(2);
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

  it("rebuilds when the focused cursor enters inline math", () => {
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

  it("rebuilds on focus gain when the cursor touches inline math", () => {
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

  it("drops inline math widgets when deleting the opening delimiter", () => {
    const doc = "before $x$ after";
    const state = createMathRenderState(doc, 0);
    const start = doc.indexOf("$x$");

    const after = state.update({
      changes: { from: start, to: start + 1, insert: "" },
    }).state;

    const widgetSpecs = getDecorationSpecs(after.field(mathDecorationField))
      .filter((spec) => spec.widgetClass === "MathWidget");

    expect(widgetSpecs).toHaveLength(0);
  });

  it("refreshes visible math metadata after a position-only edit", async () => {
    const doc = "hello $x$ end";
    const currentView = createMathRenderView(doc, 0);

    currentView.dispatch({
      changes: { from: 0, to: 0, insert: "abc" },
    });

    await vi.waitFor(() => {
      const widgetEl = currentView.contentDOM.querySelector<HTMLElement>(`.${CSS.mathInline}[aria-label="x"]`);
      expect(widgetEl).not.toBeNull();
      if (!widgetEl) throw new Error("expected x widget");
      expect(widgetEl.dataset.sourceFrom).toBe("9");
      expect(widgetEl.dataset.sourceTo).toBe("12");
      expect(widgetSourceMap.get(widgetEl)?.sourceFrom).toBe(9);
      expect(widgetSourceMap.get(widgetEl)?.sourceTo).toBe(12);
    });
  });

  it("renders inline math document-wide while keeping display math rendered", () => {
    const inlineLines = Array.from(
      { length: 20 },
      (_, index) => `line ${index + 1} $x_${index + 1}$`,
    );
    const doc = [...inlineLines, "", "$$z$$", ""].join("\n");
    const state = createMathRenderState(doc, 0);

    const widgetSpecs = getDecorationSpecs(state.field(mathDecorationField))
      .filter((spec) => spec.widgetClass === "MathWidget");

    expect(widgetSpecs.filter((spec) => spec.block === true)).toHaveLength(1);
    expect(widgetSpecs.filter((spec) => spec.block !== true)).toHaveLength(20);
  });

  it("rebuilds when the inline math viewport band changes", () => {
    const inlineLines = Array.from(
      { length: 20 },
      (_, index) => `line ${index + 1} $x_${index + 1}$`,
    );
    const doc = inlineLines.join("\n");
    const state = createMathRenderState(doc, 0);
    const before = getDecorationSpecs(state.field(mathDecorationField))
      .filter((spec) => spec.widgetClass === "MathWidget");

    const from = state.doc.line(15).from;
    const to = state.doc.line(20).to;
    const afterState = state.update({
      effects: setInlineMathViewportRangesEffect.of([{ from, to }]),
    }).state;
    const after = getDecorationSpecs(afterState.field(mathDecorationField))
      .filter((spec) => spec.widgetClass === "MathWidget");

    expect(afterState.field(mathDecorationField)).not.toBe(state.field(mathDecorationField));
    expect(before).toHaveLength(20);
    expect(after).toHaveLength(6);
  });
});

describe("live math widget metadata", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
    clearKatexCache();
  });

  it("refreshes later widget metadata and click targets after editing earlier inline math", async () => {
    const initialDoc = "Lead $a$ text $b$ more $c$ tail $d$ done.";
    view = createMathRenderView(initialDoc);
    expect(view).toBeDefined();
    const currentView = view;
    if (!currentView) throw new Error("expected math render view");

    const insertPos = initialDoc.indexOf("$b$");
    currentView.dispatch({
      changes: { from: insertPos, to: insertPos, insert: "$x$ and " },
    });

    const regions = currentView.state.field(documentSemanticsField).mathRegions;
    expect(
      regions.map((region) => ({
        latex: region.latex,
        from: region.from,
        to: region.to,
      })),
    ).toEqual([
      { latex: "a", from: 5, to: 8 },
      { latex: "x", from: 14, to: 17 },
      { latex: "b", from: 22, to: 25 },
      { latex: "c", from: 31, to: 34 },
      { latex: "d", from: 40, to: 43 },
    ]);

    await vi.waitFor(() => {
      const cWidget = currentView.contentDOM.querySelector<HTMLElement>(`.${CSS.mathInline}[aria-label="c"]`);
      const dWidget = currentView.contentDOM.querySelector<HTMLElement>(`.${CSS.mathInline}[aria-label="d"]`);
      expect(cWidget).not.toBeNull();
      expect(dWidget).not.toBeNull();
      if (!cWidget || !dWidget) throw new Error("expected c and d widgets");

      expect(cWidget.dataset.sourceFrom).toBe("31");
      expect(cWidget.dataset.sourceTo).toBe("34");
      expect(widgetSourceMap.get(cWidget)?.sourceFrom).toBe(31);
      expect(widgetSourceMap.get(cWidget)?.sourceTo).toBe(34);

      expect(dWidget.dataset.sourceFrom).toBe("40");
      expect(dWidget.dataset.sourceTo).toBe("43");
      expect(widgetSourceMap.get(dWidget)?.sourceFrom).toBe(40);
      expect(widgetSourceMap.get(dWidget)?.sourceTo).toBe(43);
    });

    const dWidget = currentView.contentDOM.querySelector<HTMLElement>(`.${CSS.mathInline}[aria-label="d"]`);
    expect(dWidget).not.toBeNull();
    if (!dWidget) throw new Error("expected d widget");
    dWidget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(currentView.state.selection.main.anchor).toBeGreaterThanOrEqual(40);
    expect(currentView.state.selection.main.anchor).toBeLessThanOrEqual(43);
  });

  it("refreshes later widget metadata after multi-transaction typing in rich mode", async () => {
    const initialDoc = "Lead $a$ text $b$ more $c$ tail $d$ done.";
    view = createMathRenderView(initialDoc, initialDoc.indexOf("$b$"));
    expect(view).toBeDefined();
    const currentView = view;
    if (!currentView) throw new Error("expected math render view");

    for (const ch of "$x$ and ") {
      const head = currentView.state.selection.main.head;
      currentView.dispatch({
        changes: { from: head, to: head, insert: ch },
        selection: { anchor: head + ch.length },
      });
    }

    await vi.waitFor(() => {
      const cWidget = currentView.contentDOM.querySelector<HTMLElement>(`.${CSS.mathInline}[aria-label="c"]`);
      const dWidget = currentView.contentDOM.querySelector<HTMLElement>(`.${CSS.mathInline}[aria-label="d"]`);
      expect(cWidget).not.toBeNull();
      expect(dWidget).not.toBeNull();
      if (!cWidget || !dWidget) throw new Error("expected c and d widgets");
      expect(cWidget.dataset.sourceFrom).toBe("31");
      expect(cWidget.dataset.sourceTo).toBe("34");
      expect(dWidget.dataset.sourceFrom).toBe("40");
      expect(dWidget.dataset.sourceTo).toBe("43");
    });
  });
});

describe("inline math mouse selection integration", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
    vi.restoreAllMocks();
    clearKatexCache();
  });

  it("defers a selection that starts on rendered inline math until the drag direction is known", () => {
    const doc = "haha $x^2$, $y^2$";
    view = createMathRenderView(doc, 0);
    const currentView = view;
    if (!currentView) throw new Error("expected math render view");

    const inline = currentView.contentDOM.querySelector<HTMLElement>(`.${CSS.mathInline}[aria-label="x^2"]`);
    expect(inline).not.toBeNull();

    const sourceFrom = Number.parseInt(inline?.dataset.sourceFrom ?? "", 10);
    const sourceTo = Number.parseInt(inline?.dataset.sourceTo ?? "", 10);
    expect(Number.isFinite(sourceFrom)).toBe(true);
    expect(Number.isFinite(sourceTo)).toBe(true);

    vi.spyOn(currentView, "posAndSideAtCoords").mockImplementation((coords) => {
      if (coords.x > 10) {
        return { pos: sourceTo + 1, assoc: 1 } as ReturnType<EditorView["posAndSideAtCoords"]>;
      }
      return { pos: sourceFrom - 2, assoc: -1 } as ReturnType<EditorView["posAndSideAtCoords"]>;
    });

    const startEvent = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 10,
      clientY: 5,
      detail: 1,
    });
    Object.defineProperty(startEvent, "target", { value: inline });

    const makeStyle = currentView.state.facet(EditorView.mouseSelectionStyle)[0];
    const style = makeStyle(currentView, startEvent);
    expect(style).not.toBeNull();
    if (!style) throw new Error("expected inline math mouse selection style");

    expect(style.get(startEvent, false, false).eq(currentView.state.selection)).toBe(true);

    const moveRight = new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 30,
      clientY: 5,
    });
    const rightSelection = style.get(moveRight, false, false);
    expect(rightSelection.main.from).toBe(sourceFrom);
    expect(rightSelection.main.to).toBe(sourceTo + 1);

    const moveLeft = new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 0,
      clientY: 5,
    });
    const leftSelection = style.get(moveLeft, false, false);
    expect(leftSelection.main.from).toBe(sourceFrom - 2);
    expect(leftSelection.main.to).toBe(sourceTo);
  });

  it("snaps a drag crossing rendered inline math to the full source span", () => {
    const doc = "haha $x^2$, $y^2$";
    view = createMathRenderView(doc, 0);
    const currentView = view;
    if (!currentView) throw new Error("expected math render view");

    const inline = currentView.contentDOM.querySelector<HTMLElement>(`.${CSS.mathInline}[aria-label="x^2"]`);
    expect(inline).not.toBeNull();

    const sourceFrom = Number.parseInt(inline?.dataset.sourceFrom ?? "", 10);
    const sourceTo = Number.parseInt(inline?.dataset.sourceTo ?? "", 10);
    expect(Number.isFinite(sourceFrom)).toBe(true);
    expect(Number.isFinite(sourceTo)).toBe(true);

    vi.spyOn(currentView, "posAndSideAtCoords").mockImplementation((coords) => {
      if (coords.x > 10) {
        return { pos: sourceFrom, assoc: 1 } as ReturnType<EditorView["posAndSideAtCoords"]>;
      }
      return { pos: sourceFrom - 4, assoc: -1 } as ReturnType<EditorView["posAndSideAtCoords"]>;
    });

    const docView = currentView.dom.ownerDocument as Document & {
      elementFromPoint?: (x: number, y: number) => Element | null;
    };
    const originalElementFromPoint = docView.elementFromPoint;
    Object.defineProperty(docView, "elementFromPoint", {
      configurable: true,
      value: (x: number) => (x > 10 ? inline : currentView.contentDOM),
    });

    const startEvent = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 0,
      clientY: 5,
      detail: 1,
    });
    Object.defineProperty(startEvent, "target", { value: currentView.contentDOM });

    const makeStyle = currentView.state.facet(EditorView.mouseSelectionStyle)[0];
    const style = makeStyle(currentView, startEvent);
    expect(style).not.toBeNull();
    if (!style) throw new Error("expected inline math mouse selection style");

    const moveIntoMath = new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 20,
      clientY: 5,
    });
    Object.defineProperty(moveIntoMath, "target", { value: inline });

    try {
      const selection = style.get(moveIntoMath, false, false);
      expect(selection.main.from).toBe(sourceFrom - 4);
      expect(selection.main.to).toBe(sourceTo);
    } finally {
      if (originalElementFromPoint) {
        Object.defineProperty(docView, "elementFromPoint", {
          configurable: true,
          value: originalElementFromPoint,
        });
      } else {
        Reflect.deleteProperty(docView, "elementFromPoint");
      }
    }
  });

  it("falls back to native mouse selection when no inline math is rendered", () => {
    view = createMathRenderView("plain text", 0);
    const currentView = view;
    if (!currentView) throw new Error("expected math render view");

    const startEvent = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 5,
      clientY: 5,
      detail: 1,
    });
    Object.defineProperty(startEvent, "target", { value: currentView.contentDOM });

    const makeStyle = currentView.state.facet(EditorView.mouseSelectionStyle)[0];
    expect(makeStyle(currentView, startEvent)).toBeNull();
  });
});

describe("math reveal transitions", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
    clearKatexCache();
  });

  it("reveals source when the focused cursor enters inline math", () => {
    view = createMathView("text $x^2$ more", 0);
    let ranges = collectMathRanges(view);
    expect(ranges.length).toBe(1);

    view.dispatch({ selection: { anchor: 7 } });
    ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(0);
  });

  it("renders again when the focused cursor leaves inline math", () => {
    view = createMathView("text $x^2$ more", 0);
    view.dispatch({ selection: { anchor: 7 } });
    let ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(0);

    view.dispatch({ selection: { anchor: 0 } });
    ranges = collectMathRanges(view);
    expect(ranges.length).toBe(1);
  });

  it("only reveals the math region containing the focused cursor", () => {
    view = createMathView("$a$ and $b$ and $c$", 0);
    view.dispatch({ selection: { anchor: 9 } });
    const ranges = collectMathRanges(view);
    expect(countWidgets(ranges)).toBe(2);
  });
});

describe("focused inline math touch reveal", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
    clearKatexCache();
  });

  it("reveals source when the cursor enters inline math and rerenders when it leaves", () => {
    const doc = "text $x^2$ more";
    view = createMathRenderView(doc, 0);

    expect(view.contentDOM.querySelector(`.${CSS.mathInline}`)).not.toBeNull();
    expect(view.contentDOM.querySelector(`.${CSS.mathSource}`)).toBeNull();

    view.dispatch({ selection: { anchor: 7 } });

    expect(view.contentDOM.querySelector(`.${CSS.mathInline}`)).toBeNull();
    expect(view.contentDOM.querySelector(`.${CSS.mathSource}`)).not.toBeNull();

    view.dispatch({ selection: { anchor: 0 } });

    expect(view.contentDOM.querySelector(`.${CSS.mathSource}`)).toBeNull();
    expect(view.contentDOM.querySelector(`.${CSS.mathInline}`)).not.toBeNull();
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
    renderKatexToHtml("x^2", false, {}, "html");
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

function getWidgets(ranges: ReturnType<typeof collectMathRanges>): MathWidget[] {
  return ranges
    .filter((range) => range.value.spec.widget)
    .map((range) => range.value.spec.widget as MathWidget);
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

  it("renders equation numbers from document semantics", () => {
    const doc = "$$x^2$$ {#eq:first}\n\n$$y^2$$ {#eq:second}";
    view = createMathViewWithLabels(doc, doc.length);
    const widgets = getWidgets(collectMathRanges(view));

    expect(widgets).toHaveLength(2);
    expect(widgets[0].toDOM().querySelector(`.${CSS.mathDisplayNumber}`)?.textContent).toBe("(1)");
    expect(widgets[1].toDOM().querySelector(`.${CSS.mathDisplayNumber}`)?.textContent).toBe("(2)");
  });

  it("unlabeled display math still renders correctly", () => {
    const doc = "$$x^2$$";
    view = createMathViewWithLabels(doc, doc.length);
    const ranges = collectMathRanges(view);
    const el = getFirstWidget(ranges).toDOM();
    expect(el.querySelector(".katex-display")).not.toBeNull();
    expect(el.querySelector(`.${CSS.mathDisplayNumber}`)).toBeNull();
  });
});

describe("_snapToTokenBoundary", () => {
  it("snaps to the start of a backslash command", () => {
    // latex: \alpha + \beta, contentFrom: 10
    // offset 0: \alpha (0-5), offset 7: +, offset 9: \beta (9-13)
    const latex = "\\alpha + \\beta";
    expect(_snapToTokenBoundary(latex, 10, 12)).toBe(10); // mid-\alpha → snap to \alpha
    expect(_snapToTokenBoundary(latex, 10, 15)).toBe(16); // offset 5 is end of \alpha, nearest is ' ' at 6 → 16
  });

  it("snaps to single-char tokens", () => {
    const latex = "x+y";
    expect(_snapToTokenBoundary(latex, 0, 0)).toBe(0); // x
    expect(_snapToTokenBoundary(latex, 0, 1)).toBe(1); // +
    expect(_snapToTokenBoundary(latex, 0, 2)).toBe(2); // y
  });

  it("handles backslash-symbol commands like \\,", () => {
    const latex = "a\\,b";
    // tokens: a(0), \,(1-2), b(3)
    expect(_snapToTokenBoundary(latex, 0, 1)).toBe(1); // \,
    expect(_snapToTokenBoundary(latex, 0, 2)).toBe(1); // mid \, → snap to \,
  });

  it("snaps to end of expression", () => {
    const latex = "xy";
    expect(_snapToTokenBoundary(latex, 100, 102)).toBe(102); // end
  });
});
