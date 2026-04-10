import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSS } from "../constants";
import {
  createMarkdownLanguageExtensions,
} from "../editor/base-editor-extensions";
import { frontmatterField } from "../editor/frontmatter-state";
import { documentAnalysisField } from "../state/document-analysis";
import { mathMacrosField } from "../state/math-macros";

const { mathPreviewPlugin } = await import("./math-preview");

interface PositionRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function makeCoords(left: number, top: number, bottom: number): PositionRect {
  return { left, right: left, top, bottom };
}

interface MeasureRequest {
  key?: unknown;
  read?: () => unknown;
  write?: (value: unknown) => void;
}

function createPreviewView(
  doc: string,
  cursorPos: number,
  extraExtensions: readonly Extension[] = [],
): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions: [
      ...createMarkdownLanguageExtensions(),
      frontmatterField,
      documentAnalysisField,
      mathMacrosField,
      mathPreviewPlugin,
      ...extraExtensions,
    ],
  });
  return new EditorView({ state, parent });
}

async function flushPositioning(): Promise<void> {
  await Promise.resolve();
}

function makeDomRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    width,
    height,
    top,
    right: left + width,
    bottom: top + height,
    left,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("math preview positioning", () => {
  const doc = "a $x$ b";
  const mathFrom = doc.indexOf("$");
  const mathTo = mathFrom + "$x$".length;
  const coordsByPos = new Map<number, PositionRect>();
  const positionMeasures = new Map<unknown, MeasureRequest>();
  let hasFocusSpy: ReturnType<typeof vi.spyOn>;
  let coordsAtPosSpy: ReturnType<typeof vi.spyOn>;
  let requestMeasureSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    coordsByPos.clear();
    positionMeasures.clear();

    hasFocusSpy = vi.spyOn(EditorView.prototype, "hasFocus", "get").mockReturnValue(true);
    coordsAtPosSpy = vi.spyOn(EditorView.prototype, "coordsAtPos").mockImplementation((pos) => {
      return coordsByPos.get(pos) ?? null;
    });
    requestMeasureSpy = vi.spyOn(EditorView.prototype, "requestMeasure").mockImplementation((request) => {
      if (request?.key === "cf-math-preview-pos") {
        positionMeasures.set(request.key, request as MeasureRequest);
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    hasFocusSpy.mockRestore();
    coordsAtPosSpy.mockRestore();
    requestMeasureSpy.mockRestore();
    document.body.innerHTML = "";
  });

  async function flushScheduledMeasures(): Promise<void> {
    while (positionMeasures.size > 0) {
      const pending = [...positionMeasures.values()];
      positionMeasures.clear();
      for (const request of pending) {
        const measurement = request.read?.();
        request.write?.(measurement);
      }
      await flushPositioning();
    }
  }

  it("anchors the panel inside the editor scroller using document coordinates", async () => {
    coordsByPos.set(mathFrom, makeCoords(200, 80, 100));
    coordsByPos.set(mathTo, makeCoords(240, 80, 120));

    const view = createPreviewView(doc, mathFrom + 1);
    view.scrollDOM.scrollLeft = 12;
    view.scrollDOM.scrollTop = 300;
    view.scrollDOM.getBoundingClientRect = () => makeDomRect(40, 60, 500, 400);
    const panel = view.dom.querySelector<HTMLElement>(".cf-math-preview");

    expect(panel).not.toBeNull();
    expect(coordsAtPosSpy).not.toHaveBeenCalled();
    expect(positionMeasures.size).toBe(1);
    expect(view.scrollDOM.classList.contains(CSS.mathPreviewScroller)).toBe(true);
    expect(panel?.parentElement?.classList.contains(CSS.mathPreviewLayer)).toBe(true);

    await flushScheduledMeasures();

    expect(panel?.style.left).toBe("172px");
    expect(panel?.style.top).toBe("364px");
    expect(coordsAtPosSpy).toHaveBeenCalledTimes(2);

    view.scrollDOM.scrollTop = 500;
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    await flushScheduledMeasures();

    expect(coordsAtPosSpy).toHaveBeenCalledTimes(2);
    expect(positionMeasures.size).toBe(0);
    expect(panel?.style.left).toBe("172px");
    expect(panel?.style.top).toBe("364px");

    view.destroy();
    expect(view.scrollDOM.classList.contains(CSS.mathPreviewScroller)).toBe(false);
  });

  it("sizes the panel from rendered math width instead of the shared preview-card max width", async () => {
    coordsByPos.set(mathFrom, makeCoords(200, 80, 100));
    coordsByPos.set(mathTo, makeCoords(240, 80, 120));

    const view = createPreviewView(doc, mathFrom + 1);
    view.scrollDOM.getBoundingClientRect = () => makeDomRect(40, 60, 500, 400);

    const panel = view.dom.querySelector<HTMLElement>(".cf-math-preview");
    const content = view.dom.querySelector<HTMLElement>(".cf-math-preview-content");
    expect(panel).not.toBeNull();
    expect(content).not.toBeNull();
    if (!panel || !content) {
      throw new Error("expected math preview panel");
    }

    Object.defineProperty(content, "scrollWidth", {
      configurable: true,
      get: () => 320,
    });

    await flushScheduledMeasures();

    expect(panel.style.maxWidth).toBe("490px");
    expect(panel.style.width).toBe("320px");

    view.destroy();
  });

  it("preserves a manual drag as an override for later same-region selection updates", async () => {
    coordsByPos.set(mathFrom, makeCoords(200, 80, 100));
    coordsByPos.set(mathTo, makeCoords(240, 80, 120));

    const view = createPreviewView(doc, mathFrom + 1);
    view.scrollDOM.scrollLeft = 20;
    view.scrollDOM.scrollTop = 300;
    view.scrollDOM.getBoundingClientRect = () => makeDomRect(40, 60, 500, 400);
    await flushScheduledMeasures();

    const panel = view.dom.querySelector<HTMLElement>(".cf-math-preview");
    expect(panel).not.toBeNull();
    if (!panel) {
      throw new Error("expected math preview panel");
    }
    const content = panel.querySelector<HTMLElement>(".cf-math-preview-content");
    expect(content).not.toBeNull();
    if (!content) {
      throw new Error("expected math preview content");
    }

    panel.getBoundingClientRect = () => ({
      x: 180,
      y: 364,
      width: 80,
      height: 40,
      top: 364,
      right: 260,
      bottom: 404,
      left: 180,
      toJSON: () => ({}),
    });

    panel.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: 215,
      clientY: 374,
    }));
    document.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      clientX: 315,
      clientY: 474,
    }));
    document.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
    }));

    expect(panel.style.left).toBe("260px");
    expect(panel.style.top).toBe("704px");

    positionMeasures.clear();
    view.dispatch({ selection: { anchor: mathTo - 1 } });
    await flushScheduledMeasures();

    expect(positionMeasures.size).toBe(0);
    expect(panel.style.left).toBe("260px");
    expect(panel.style.top).toBe("704px");

    view.destroy();
  });

  it("does not start a polling timer while the preview is open", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    coordsByPos.set(mathFrom, makeCoords(200, 80, 100));
    coordsByPos.set(mathTo, makeCoords(240, 80, 120));

    const view = createPreviewView(doc, mathFrom + 1);
    view.scrollDOM.getBoundingClientRect = () => makeDomRect(0, 0, 500, 400);
    await flushScheduledMeasures();

    const panel = view.dom.querySelector<HTMLElement>(".cf-math-preview");
    expect(panel).not.toBeNull();
    expect(setIntervalSpy).not.toHaveBeenCalled();

    view.destroy();
    setIntervalSpy.mockRestore();
  });

  it("does not show the preview for display math", async () => {
    const displayDoc = "$$\nx\n$$";
    const displayFrom = 0;
    const displayTo = displayDoc.length;
    coordsByPos.set(displayFrom, makeCoords(120, 80, 100));
    coordsByPos.set(displayTo, makeCoords(180, 120, 140));

    const view = createPreviewView(displayDoc, 3);
    view.scrollDOM.scrollLeft = 8;
    view.scrollDOM.scrollTop = 40;
    view.scrollDOM.getBoundingClientRect = () => makeDomRect(20, 10, 500, 400);
    await flushScheduledMeasures();

    const panel = view.dom.querySelector<HTMLElement>(".cf-math-preview");
    expect(panel).toBeNull();
    expect(positionMeasures.size).toBe(0);

    view.destroy();
  });

  it("tears down drag listeners with a shared abort signal when destroyed", async () => {
    const addEventListenerSpy = vi.spyOn(document, "addEventListener");
    coordsByPos.set(mathFrom, makeCoords(200, 80, 100));
    coordsByPos.set(mathTo, makeCoords(240, 80, 120));

    const view = createPreviewView(doc, mathFrom + 1);
    view.scrollDOM.getBoundingClientRect = () => makeDomRect(0, 0, 500, 400);
    await flushScheduledMeasures();

    const panel = view.dom.querySelector<HTMLElement>(".cf-math-preview");
    expect(panel).not.toBeNull();
    if (!panel) {
      throw new Error("expected math preview panel");
    }
    const content = panel.querySelector<HTMLElement>(".cf-math-preview-content");
    expect(content).not.toBeNull();
    if (!content) {
      throw new Error("expected math preview content");
    }

    const mouseMoveCall = addEventListenerSpy.mock.calls.find(([type]) => type === "mousemove");
    const mouseUpCall = addEventListenerSpy.mock.calls.find(([type]) => type === "mouseup");
    const dragSignal = (mouseMoveCall?.[2] as AddEventListenerOptions | undefined)?.signal;
    const layer = view.scrollDOM.querySelector(`.${CSS.mathPreviewLayer}`);

    expect(dragSignal).toBeInstanceOf(AbortSignal);
    expect((mouseUpCall?.[2] as AddEventListenerOptions | undefined)?.signal).toBe(dragSignal);
    expect(layer).not.toBeNull();

    view.destroy();
    expect(view.scrollDOM.querySelector(`.${CSS.mathPreviewLayer}`)).toBeNull();
    expect(view.scrollDOM.classList.contains(CSS.mathPreviewScroller)).toBe(false);

    const staleMouseDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: 215,
      clientY: 134,
    });
    panel.dispatchEvent(staleMouseDown);
    expect(staleMouseDown.defaultPrevented).toBe(false);

    const staleContentMouseDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: 215,
      clientY: 134,
    });
    content.dispatchEvent(staleContentMouseDown);
    expect(staleContentMouseDown.defaultPrevented).toBe(false);

    addEventListenerSpy.mockRestore();
  });

  it("repositions after inline math edits through the editor update path", async () => {
    coordsByPos.set(mathFrom, makeCoords(200, 80, 100));
    coordsByPos.set(mathTo, makeCoords(240, 80, 120));

    const view = createPreviewView(doc, mathFrom + 1);
    view.scrollDOM.scrollLeft = 5;
    view.scrollDOM.scrollTop = 50;
    view.scrollDOM.getBoundingClientRect = () => makeDomRect(25, 10, 500, 400);
    await flushScheduledMeasures();

    const panel = view.dom.querySelector<HTMLElement>(".cf-math-preview");
    expect(panel).not.toBeNull();
    expect(panel?.style.left).toBe("180px");
    expect(panel?.style.top).toBe("164px");

    const newMathTo = mathTo + 2;
    coordsByPos.delete(mathTo);
    coordsByPos.set(mathFrom, makeCoords(230, 90, 110));
    coordsByPos.set(newMathTo, makeCoords(290, 90, 130));

    view.dispatch({
      changes: { from: mathTo - 1, insert: "yz" },
      selection: { anchor: newMathTo - 1 },
    });

    expect(positionMeasures.size).toBe(1);
    await flushScheduledMeasures();

    expect(panel?.style.left).toBe("210px");
    expect(panel?.style.top).toBe("174px");

    view.destroy();
  });

  it("anchors to the inline math boundaries instead of cursor-sensitive boundary fallbacks", async () => {
    coordsAtPosSpy.mockImplementation(function (
      this: EditorView,
      pos: number,
      side?: -1 | 1,
    ) {
      const cursor = this.state.selection.main.from;

      if (pos === mathFrom) {
        if (side === 1) return makeCoords(200, 80, 100);
        return cursor === mathFrom + 1
          ? makeCoords(198, 80, 100)
          : makeCoords(204, 80, 100);
      }

      if (pos === mathTo) {
        if (side === -1) return makeCoords(240, 80, 120);
        return cursor === mathFrom + 1
          ? makeCoords(240, 80, 118)
          : makeCoords(240, 80, 126);
      }

      return null;
    });

    const view = createPreviewView(doc, mathFrom + 1);
    view.scrollDOM.getBoundingClientRect = () => makeDomRect(0, 0, 500, 400);
    await flushScheduledMeasures();

    const panel = view.dom.querySelector<HTMLElement>(".cf-math-preview");
    expect(panel).not.toBeNull();
    expect(panel?.style.left).toBe("200px");
    expect(panel?.style.top).toBe("124px");
    expect(coordsAtPosSpy.mock.calls.slice(0, 2)).toEqual([
      [mathFrom, 1],
      [mathTo, -1],
    ]);

    view.dispatch({ selection: { anchor: mathTo - 1 } });
    await flushScheduledMeasures();

    expect(positionMeasures.size).toBe(0);
    expect(coordsAtPosSpy).toHaveBeenCalledTimes(2);
    expect(panel?.style.left).toBe("200px");
    expect(panel?.style.top).toBe("124px");

    view.destroy();
  });

  it("repositions on same-region geometry reflow", async () => {
    coordsByPos.set(mathFrom, makeCoords(200, 80, 100));
    coordsByPos.set(mathTo, makeCoords(240, 80, 120));

    const view = createPreviewView(doc, mathFrom + 1);
    view.scrollDOM.scrollLeft = 5;
    view.scrollDOM.scrollTop = 50;
    view.scrollDOM.getBoundingClientRect = () => makeDomRect(25, 10, 500, 400);
    await flushScheduledMeasures();

    const panel = view.dom.querySelector<HTMLElement>(".cf-math-preview");
    expect(panel).not.toBeNull();
    expect(panel?.style.left).toBe("180px");
    expect(panel?.style.top).toBe("164px");

    coordsByPos.set(mathFrom, makeCoords(260, 140, 160));
    coordsByPos.set(mathTo, makeCoords(320, 140, 180));

    const plugin = view.plugin(mathPreviewPlugin as never) as
      | { scheduleCheck(options?: { forceReposition?: boolean }): void }
      | null;
    expect(plugin).not.toBeNull();
    plugin?.scheduleCheck({ forceReposition: true });

    expect(positionMeasures.size).toBe(1);
    await flushScheduledMeasures();

    expect(panel?.style.left).toBe("240px");
    expect(panel?.style.top).toBe("224px");

    view.destroy();
  });
});
