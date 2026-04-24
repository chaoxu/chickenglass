import { afterEach, describe, expect, it, vi } from "vitest";
import katex from "katex";
import { CSS } from "../constants/css-classes";
import { createMockEditorView } from "../test-utils";
import { renderInlineMarkdown } from "./inline-render";
import { renderKatexToHtml } from "./inline-shared";
import { MathWidget, clearKatexCache, renderKatex } from "./math-widget";
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

  it("keeps inline widget DOM on the lightweight KaTeX HTML path", () => {
    const widget = new MathWidget("x^2", "$x^2$", false);
    const el = widget.toDOM();
    expect(el.querySelector(".katex-html")).not.toBeNull();
    expect(el.querySelector(".katex-mathml")).toBeNull();
  });

  it("dispatches to updated position after updateSourceRange", () => {
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
});

describe("MathWidget (display)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a div with cf-math-display class", () => {
    const widget = new MathWidget("x^2", "$$x^2$$", true);
    const el = widget.toDOM();
    expect(el.tagName).toBe("DIV");
    expect(el.classList.contains(CSS.mathDisplay)).toBe(true);
  });

  it("renders an equation number when provided", () => {
    const widget = new MathWidget("x^2", "$$x^2$$", true, {}, 0, 7);
    const el = widget.toDOM();
    expect(el.classList.contains(CSS.mathDisplayNumbered)).toBe(true);
    expect(el.querySelector(`.${CSS.mathDisplayNumber}`)?.textContent).toBe("(7)");
  });

  it("reuses cached display DOM across equal widget instances", () => {
    const first = new MathWidget("x^2", "$$x^2$$", true);
    expect(first.toDOM().querySelector(".katex-display")).not.toBeNull();

    vi.spyOn(katex, "renderToString").mockImplementation(() => {
      throw new Error("display cache miss");
    });

    const second = new MathWidget("x^2", "$$x^2$$", true);
    expect(second.toDOM().querySelector(".katex-display")).not.toBeNull();
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
    content?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(focus).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      selection: { anchor: 8 },
      scrollIntoView: false,
    });
  });

  it("stamps shell-surface range attributes for display math", () => {
    const widget = new MathWidget("x^2", "$$x^2$$", true);
    widget.updateSourceRange(8, 15);

    const el = widget.toDOM();

    expect(el.dataset.shellFrom).toBe("8");
    expect(el.dataset.shellTo).toBe("15");
  });

  it("provides a stable fallback estimatedHeight before the first measurement", () => {
    const widget = new MathWidget("x^2", "$$x^2$$", true);
    expect(widget.estimatedHeight).toBe(32);
  });

  it("uses a taller fallback estimate for multiline display math", () => {
    const widget = new MathWidget("a \\\\\n b", "$$\na \\\\\n b\n$$", true);
    expect(widget.estimatedHeight).toBeGreaterThan(32);
  });
});

describe("MathWidget shell-surface ownership", () => {
  it("keeps inline math out of shell-surface widget measurement", () => {
    const widget = new MathWidget("x^2", "$x^2$", false);
    widget.updateSourceRange(10, 15);

    const el = widget.toDOM();

    expect(el.dataset.shellFrom).toBeUndefined();
    expect(el.dataset.shellTo).toBeUndefined();
  });
});

describe("MathWidget.updateDOM", () => {
  it("updates inline math content and refreshes source-range metadata", () => {
    const oldWidget = new MathWidget("x^2", "$x^2$", false);
    oldWidget.sourceFrom = 10;
    oldWidget.sourceTo = 15;
    const dom = oldWidget.toDOM();

    const newWidget = new MathWidget("y^2", "$y^2$", false);
    newWidget.sourceFrom = 20;
    newWidget.sourceTo = 25;

    expect(newWidget.updateDOM(dom)).toBe(true);
    expect(widgetSourceMap.get(dom)).toBe(newWidget);
    expect(dom.dataset.sourceFrom).toBe("20");
    expect(dom.dataset.sourceTo).toBe("25");
    expect(dom.getAttribute("aria-label")).toBe("y^2");
  });

  it("updates display math equation numbers without rebuilding the DOM node", () => {
    const oldWidget = new MathWidget("x^2", "$$x^2$$", true, {}, 0, 1);
    const dom = oldWidget.toDOM();

    const newWidget = new MathWidget("x^2", "$$x^2$$", true, {}, 0, 2);
    expect(newWidget.updateDOM(dom)).toBe(true);
    expect(dom.querySelector(`.${CSS.mathDisplayNumber}`)?.textContent).toBe("(2)");
  });
});

describe("renderKatex", () => {
  afterEach(() => {
    clearKatexCache();
    vi.restoreAllMocks();
  });

  it("includes source-location attributes in cached KaTeX HTML", () => {
    const html = renderKatexToHtml("x^2+y^2", false, {});
    expect(html).toContain("data-loc-start");
    expect(html).toContain("data-loc-end");
  });

  it("renders grouped inline math with location metadata", () => {
    const el = document.createElement("span");
    renderKatex(el, "\\frac{a}{b}+c", false, {});
    expect(el.querySelectorAll("[data-loc-start]").length).toBeGreaterThan(0);
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
