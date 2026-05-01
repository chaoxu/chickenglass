import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import {
  collectMathRanges,
  _mathDecorationFieldForTest as mathDecorationField,
  clearKatexCache,
} from "./math-render";
import { getDecorationSpecs } from "../test-utils";
import { widgetSourceMap } from "./render-utils";
import { documentSemanticsField } from "../state/document-analysis";
import {
  activateDisplayMathSourceView,
  countWidgets,
  createMathRenderView,
  createMathView,
} from "./math-render-test-utils";

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

  it("keeps one display widget while editing active display math repeatedly", () => {
    const initialDoc = ["Before", "", "$$", "x", "$$", "", "After"].join("\n");
    view = createMathRenderView(initialDoc, initialDoc.indexOf("x"));
    const currentView = view;
    activateDisplayMathSourceView(currentView, initialDoc.indexOf("x"));

    for (const ch of ["_", "1", " ", "+", " ", "y"]) {
      const head = currentView.state.selection.main.head;
      currentView.dispatch({
        changes: { from: head, insert: ch },
        selection: { anchor: head + ch.length },
      });

      const widgets = getDecorationSpecs(currentView.state.field(mathDecorationField))
        .filter((spec) => spec.widgetClass === "MathWidget" && spec.block === true);
      expect(widgets).toHaveLength(1);
    }
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
