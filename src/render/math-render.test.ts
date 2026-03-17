import { describe, expect, it, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { InlineMathWidget, DisplayMathWidget, mathRenderPlugin } from "./math-render";
import { focusEffect } from "./render-utils";

/** Create an EditorView with math parser extensions and the math render plugin. */
function createMathView(doc: string, cursorPos?: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: cursorPos !== undefined ? { anchor: cursorPos } : undefined,
    extensions: [
      markdown({ extensions: [mathExtension] }),
      mathRenderPlugin,
    ],
  });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ state, parent });
  // Simulate focus so the StateField knows the editor is focused
  view.dispatch({ effects: focusEffect.of(true) });
  const origDestroy = view.destroy.bind(view);
  view.destroy = () => { origDestroy(); parent.remove(); };
  return view;
}

/** Count replace decorations in the current editor state. */
function countMathDecorations(view: EditorView): number {
  let count = 0;
  // Iterate over all decoration sets provided to the editor
  // The mathDecorationField provides decorations via EditorView.decorations
  // We can check by looking at the DOM or by counting widget decorations
  const cursor = view.state.facet(EditorView.decorations);
  for (const source of cursor) {
    const decoSet = typeof source === "function" ? source(view) : source;
    const iter = decoSet.iter();
    while (iter.value) {
      if (iter.value.spec.widget instanceof InlineMathWidget ||
          iter.value.spec.widget instanceof DisplayMathWidget) {
        count++;
      }
      iter.next();
    }
  }
  return count;
}

describe("InlineMathWidget", () => {
  it("creates a span with cg-math-inline class", () => {
    const widget = new InlineMathWidget("x^2", "$x^2$");
    const el = widget.toDOM();
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe("cg-math-inline");
  });

  it("renders KaTeX content inside the span", () => {
    const widget = new InlineMathWidget("x^2", "$x^2$");
    const el = widget.toDOM();
    expect(el.querySelector(".katex")).not.toBeNull();
  });

  it("shows error for invalid LaTeX", () => {
    const widget = new InlineMathWidget("\\invalid{", "$\\invalid{$");
    const el = widget.toDOM();
    // throwOnError is false, so KaTeX handles errors gracefully
    // The element should still render without throwing
    expect(el.tagName).toBe("SPAN");
  });

  it("eq returns true for same raw content", () => {
    const a = new InlineMathWidget("x^2", "$x^2$");
    const b = new InlineMathWidget("x^2", "$x^2$");
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different raw content", () => {
    const a = new InlineMathWidget("x^2", "$x^2$");
    const b = new InlineMathWidget("y^2", "$y^2$");
    expect(a.eq(b)).toBe(false);
  });

  it("eq distinguishes dollar and backslash syntax with same LaTeX", () => {
    const a = new InlineMathWidget("x", "$x$");
    const b = new InlineMathWidget("x", "\\(x\\)");
    expect(a.eq(b)).toBe(false);
  });
});

describe("DisplayMathWidget", () => {
  it("creates a div with cg-math-display class", () => {
    const widget = new DisplayMathWidget("x^2", "$$x^2$$");
    const el = widget.toDOM();
    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe("cg-math-display");
  });

  it("renders KaTeX content in display mode", () => {
    const widget = new DisplayMathWidget("x^2", "$$x^2$$");
    const el = widget.toDOM();
    expect(el.querySelector(".katex-display")).not.toBeNull();
  });

  it("shows error for invalid LaTeX", () => {
    const widget = new DisplayMathWidget("\\bad{", "$$\\bad{$$");
    const el = widget.toDOM();
    expect(el.tagName).toBe("DIV");
  });

  it("eq returns true for same raw content", () => {
    const a = new DisplayMathWidget("x", "$$x$$");
    const b = new DisplayMathWidget("x", "$$x$$");
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different raw content", () => {
    const a = new DisplayMathWidget("x", "$$x$$");
    const b = new DisplayMathWidget("y", "$$y$$");
    expect(a.eq(b)).toBe(false);
  });
});

describe("mathRenderPlugin decorations", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("decorates inline math with dollar syntax", () => {
    view = createMathView("text $x^2$ more", 0);
    expect(countMathDecorations(view)).toBe(1);
  });

  it("decorates inline math with backslash-paren syntax", () => {
    view = createMathView("text \\(x^2\\) more", 0);
    expect(countMathDecorations(view)).toBe(1);
  });

  it("does not decorate math when cursor is inside", () => {
    // Cursor at position 7 is inside "$x^2$" which spans 5..10
    view = createMathView("text $x^2$ more", 7);
    expect(countMathDecorations(view)).toBe(0);
  });

  it("does not decorate math when cursor is at math boundary", () => {
    // Cursor at position 5 is at the start of "$x^2$"
    view = createMathView("text $x^2$ more", 5);
    expect(countMathDecorations(view)).toBe(0);
  });

  it("decorates display math with dollar-dollar syntax", () => {
    const doc = "before\n\n$$x^2$$\n\nafter";
    view = createMathView(doc, doc.length);
    expect(countMathDecorations(view)).toBe(1);
  });

  it("decorates display math with backslash-bracket syntax", () => {
    const doc = "before\n\n\\[x^2\\]\n\nafter";
    view = createMathView(doc, doc.length);
    expect(countMathDecorations(view)).toBe(1);
  });

  it("does not decorate display math when cursor is inside", () => {
    const doc = "before\n\n$$x^2$$\n\nafter";
    // Cursor inside the $$ block
    view = createMathView(doc, 10);
    expect(countMathDecorations(view)).toBe(0);
  });

  it("decorates multiple math expressions", () => {
    const doc = "$a$ and $b$ and $c$ end";
    // Cursor at the very end, past the last math expression
    view = createMathView(doc, doc.length);
    expect(countMathDecorations(view)).toBe(3);
  });

  it("handles empty document", () => {
    view = createMathView("");
    expect(countMathDecorations(view)).toBe(0);
  });

  it("handles document with no math", () => {
    view = createMathView("just plain text", 0);
    expect(countMathDecorations(view)).toBe(0);
  });
});

describe("cursor toggle behavior", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("reveals source when cursor enters math region", () => {
    view = createMathView("text $x^2$ more", 0);
    // Initially cursor is outside, so math is decorated
    expect(countMathDecorations(view)).toBe(1);

    // Move cursor inside the math
    view.dispatch({ selection: { anchor: 7 } });
    expect(countMathDecorations(view)).toBe(0);
  });

  it("renders when cursor leaves math region", () => {
    view = createMathView("text $x^2$ more", 7);
    // Cursor inside math - no decorations
    expect(countMathDecorations(view)).toBe(0);

    // Move cursor outside
    view.dispatch({ selection: { anchor: 0 } });
    expect(countMathDecorations(view)).toBe(1);
  });

  it("only reveals the math region containing the cursor", () => {
    view = createMathView("$a$ and $b$ and $c$", 9);
    // Cursor is inside $b$ (positions 8..10), so $a$ and $c$ should be decorated
    expect(countMathDecorations(view)).toBe(2);
  });
});

describe("error handling", () => {
  it("InlineMathWidget does not throw on parse error", () => {
    const widget = new InlineMathWidget("\\frac{", "$\\frac{$");
    expect(() => widget.toDOM()).not.toThrow();
  });

  it("DisplayMathWidget does not throw on parse error", () => {
    const widget = new DisplayMathWidget("\\frac{", "$$\\frac{$$");
    expect(() => widget.toDOM()).not.toThrow();
  });

  it("handles deeply nested LaTeX without error", () => {
    const nested = "\\frac{\\frac{\\frac{1}{2}}{3}}{4}";
    const widget = new InlineMathWidget(nested, `$${nested}$`);
    const el = widget.toDOM();
    expect(el.querySelector(".katex")).not.toBeNull();
  });
});

describe("performance", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("handles 100+ equations without error", () => {
    const equations = Array.from(
      { length: 120 },
      (_, i) => `$x_{${i}}^2$`,
    ).join(" ") + " end";
    view = createMathView(equations, equations.length);
    expect(countMathDecorations(view)).toBe(120);
  });

  it("processes many display math blocks", () => {
    const blocks = Array.from(
      { length: 50 },
      (_, i) => `$$\\sum_{k=0}^{${i}} k$$`,
    ).join("\n\n") + "\n\nend";
    view = createMathView(blocks, blocks.length);
    expect(countMathDecorations(view)).toBe(50);
  });
});

/** Create an EditorView with math + equation label extensions. */
function createMathViewWithLabels(doc: string, cursorPos?: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: cursorPos !== undefined ? { anchor: cursorPos } : undefined,
    extensions: [
      markdown({ extensions: [mathExtension, equationLabelExtension] }),
      mathRenderPlugin,
    ],
  });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ state, parent });
  view.dispatch({ effects: focusEffect.of(true) });
  const origDestroy = view.destroy.bind(view);
  view.destroy = () => { origDestroy(); parent.remove(); };
  return view;
}

describe("display math with equation labels", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("decorates single-line display math with equation label", () => {
    const doc = "before\n\n$$x^2$$ {#eq:foo}\n\nafter";
    view = createMathViewWithLabels(doc, doc.length);
    expect(countMathDecorations(view)).toBe(1);
  });

  it("decorates multi-line display math with equation label", () => {
    const doc = "before\n\n$$\nx^2\n$$ {#eq:bar}\n\nafter";
    view = createMathViewWithLabels(doc, doc.length);
    expect(countMathDecorations(view)).toBe(1);
  });

  it("decorates display math without label when label extension is loaded", () => {
    const doc = "before\n\n$$x^2$$\n\nafter";
    view = createMathViewWithLabels(doc, doc.length);
    expect(countMathDecorations(view)).toBe(1);
  });

  it("inline math is unaffected by equation label extension", () => {
    const doc = "$x^2$ end";
    view = createMathViewWithLabels(doc, doc.length);
    expect(countMathDecorations(view)).toBe(1);
  });
});
