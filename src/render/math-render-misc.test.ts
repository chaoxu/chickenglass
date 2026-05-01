import { afterEach, describe, expect, it, vi } from "vitest";
import katex from "katex";
import { EditorView } from "@codemirror/view";
import { parser as lezerParser } from "@lezer/markdown";
import { CSS } from "../constants/css-classes";
import {
  MathWidget,
  _snapToTokenBoundary,
  clearKatexCache,
  collectMathRanges,
  getDisplayMathContentEnd,
  renderKatex,
  renderKatexToHtml,
  stripMathDelimiters,
} from "./math-render";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { renderInlineMarkdown } from "./inline-render";
import {
  createMathView,
  createMathViewWithLabels,
} from "./math-render-test-utils";

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
    renderKatexToHtml("x^2", false, {}, "html", true);
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
