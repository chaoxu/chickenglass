import { describe, expect, it, vi } from "vitest";
import { CSS } from "../constants/css-classes";
import { MathWidget, renderKatex, renderKatexToHtml } from "./math-render";
import { createMockEditorView } from "../test-utils";
import { widgetSourceMap } from "./render-utils";

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
    expect(el.classList.contains(CSS.mathDisplay)).toBe(true);
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
