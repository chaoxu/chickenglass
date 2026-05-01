import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import {
  collectMathRanges,
  _mathDecorationFieldForTest as mathDecorationField,
  clearKatexCache,
} from "./math-render";
import { getDecorationSpecs } from "../test-utils";
import { focusEffect, widgetSourceMap } from "./render-utils";
import { clearFrontendPerf, getFrontendPerfSnapshot } from "../lib/perf";
import {
  countMarksWithClass,
  countSourceMarks,
  countWidgets,
  createMathRenderState,
  createMathRenderView,
  createMathView,
  createMathViewWithLabels,
  activateDisplayMathSourceView,
} from "./math-render-test-utils";

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

  it("keeps decorations when delimiter-free prose changes after all math", () => {
    const equations = Array.from(
      { length: 80 },
      (_, index) => `$x_{${index}}$`,
    ).join(" ");
    const doc = `${equations}\n\nplain tail`;
    const state = createMathRenderState(doc, 0);
    const before = state.field(mathDecorationField);
    const tailText = doc.indexOf("plain");

    const after = state.update({
      changes: { from: tailText, to: tailText + 5, insert: "quiet" },
    }).state.field(mathDecorationField);

    expect(after).toBe(before);
  });

  it("maps many math decorations when delimiter-free prose before math shifts positions", () => {
    const equations = Array.from(
      { length: 80 },
      (_, index) => `$x_{${index}}$`,
    ).join(" ");
    const doc = `intro ${equations}`;
    const state = createMathRenderState(doc, 0);
    const before = state.field(mathDecorationField);

    const after = state.update({
      changes: { from: 0, to: 0, insert: "quiet " },
    }).state.field(mathDecorationField);

    expect(after).not.toBe(before);
    expect(after.size).toBe(before.size);
    expect(getDecorationSpecs(after)[0].from).toBe(getDecorationSpecs(before)[0].from + 6);
  });

  it("dirty-updates active inline math instead of rebuilding all math decorations", () => {
    const tailMath = Array.from(
      { length: 80 },
      (_, index) => `$x_{${index}}$`,
    ).join(" ");
    const doc = `Let $G = (V, E)$ be a graph.\n\n${tailMath}`;
    const activePos = doc.indexOf(" = ") + 1;
    const focused = createMathRenderState(doc, activePos).update({
      effects: focusEffect.of(true),
    }).state;
    const before = focused.field(mathDecorationField);

    clearFrontendPerf();
    const afterState = focused.update({
      changes: { from: activePos, to: activePos, insert: "1" },
      selection: { anchor: activePos + 1 },
    }).state;
    const after = afterState.field(mathDecorationField);

    const spanNames = getFrontendPerfSnapshot().recent.map((record) => record.name);
    expect(spanNames).toContain("cm6.mathDecorations.dirty");
    expect(spanNames).not.toContain("cm6.mathDecorations.rebuild");
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

  it("renders inline math for the full document while keeping display math rendered", () => {
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

  it("keeps inline math layout decorations independent of viewport-band effects", () => {
    const inlineLines = Array.from(
      { length: 20 },
      (_, index) => `line ${index + 1} $x_${index + 1}$`,
    );
    const doc = inlineLines.join("\n");
    const state = createMathRenderState(doc, 0);
    const before = getDecorationSpecs(state.field(mathDecorationField))
      .filter((spec) => spec.widgetClass === "MathWidget");

    const afterState = state.update({ selection: { anchor: state.doc.length } }).state;
    const after = getDecorationSpecs(afterState.field(mathDecorationField))
      .filter((spec) => spec.widgetClass === "MathWidget");

    expect(afterState.field(mathDecorationField)).toBe(state.field(mathDecorationField));
    expect(before).toHaveLength(20);
    expect(after).toHaveLength(20);
  });
});

