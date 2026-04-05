import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMarkdownLanguageExtensions,
  sharedDocumentStateExtensions,
} from "../editor/base-editor-extensions";
import { documentAnalysisField } from "../semantics/codemirror-source";
import { mathMacrosField } from "./math-macros";

const autoUpdateMock = vi.fn();

vi.mock("@floating-ui/dom", () => ({
  autoUpdate: (...args: unknown[]) => autoUpdateMock(...args),
}));

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
      ...sharedDocumentStateExtensions,
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

describe("math preview positioning", () => {
  const doc = "a $x$ b";
  const mathFrom = doc.indexOf("$");
  const mathTo = mathFrom + "$x$".length;
  const coordsByPos = new Map<number, PositionRect>();
  const autoUpdateCallbacks: Array<() => void> = [];
  const positionMeasures = new Map<unknown, MeasureRequest>();
  let cleanupAutoUpdate = vi.fn();
  let hasFocusSpy: ReturnType<typeof vi.spyOn>;
  let coordsAtPosSpy: ReturnType<typeof vi.spyOn>;
  let requestMeasureSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    coordsByPos.clear();
    autoUpdateCallbacks.length = 0;
    positionMeasures.clear();
    cleanupAutoUpdate = vi.fn();
    autoUpdateMock.mockReset();

    hasFocusSpy = vi.spyOn(EditorView.prototype, "hasFocus", "get").mockReturnValue(true);
    coordsAtPosSpy = vi.spyOn(EditorView.prototype, "coordsAtPos").mockImplementation((pos) => {
      return coordsByPos.get(pos) ?? null;
    });
    requestMeasureSpy = vi.spyOn(EditorView.prototype, "requestMeasure").mockImplementation((request) => {
      if (request?.key === "cf-math-preview-pos") {
        positionMeasures.set(request.key, request as MeasureRequest);
      }
    });

    autoUpdateMock.mockImplementation((_reference: unknown, _floating: unknown, update: () => void) => {
      autoUpdateCallbacks.push(update);
      update();
      return cleanupAutoUpdate;
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

  it("defers math position measurement out of the update cycle and repositions from autoUpdate callbacks", async () => {
    coordsByPos.set(mathFrom, makeCoords(200, 80, 100));
    coordsByPos.set(mathTo, makeCoords(240, 80, 120));

    const view = createPreviewView(doc, mathFrom + 1);
    const panel = view.dom.querySelector<HTMLElement>(".cf-math-preview");

    expect(panel).not.toBeNull();
    expect(coordsAtPosSpy).not.toHaveBeenCalled();
    expect(positionMeasures.size).toBe(1);
    expect(autoUpdateCallbacks).toHaveLength(1);

    const reference = autoUpdateMock.mock.calls[0]?.[0] as { contextElement?: Element };
    expect(reference.contextElement).toBe(view.contentDOM);

    await flushScheduledMeasures();

    expect(panel?.style.left).toBe("200px");
    expect(panel?.style.top).toBe("124px");
    expect(coordsAtPosSpy).toHaveBeenCalledTimes(2);

    coordsByPos.set(mathFrom, makeCoords(200, -120, -100));
    coordsByPos.set(mathTo, makeCoords(240, -120, -80));
    autoUpdateCallbacks[0]?.();
    expect(coordsAtPosSpy).toHaveBeenCalledTimes(2);
    expect(positionMeasures.size).toBe(1);

    await flushScheduledMeasures();

    expect(panel?.style.left).toBe("200px");
    expect(panel?.style.top).toBe("-76px");

    view.destroy();
    expect(cleanupAutoUpdate).toHaveBeenCalledTimes(1);
  });

  it("preserves a manual drag as an override for later auto-updates", async () => {
    coordsByPos.set(mathFrom, makeCoords(200, 80, 100));
    coordsByPos.set(mathTo, makeCoords(240, 80, 120));

    const view = createPreviewView(doc, mathFrom + 1);
    await flushScheduledMeasures();

    const panel = view.dom.querySelector<HTMLElement>(".cf-math-preview");
    expect(panel).not.toBeNull();
    if (!panel) {
      throw new Error("expected math preview panel");
    }

    panel.getBoundingClientRect = () => ({
      x: 200,
      y: 124,
      width: 80,
      height: 40,
      top: 124,
      right: 280,
      bottom: 164,
      left: 200,
      toJSON: () => ({}),
    });

    panel.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: 215,
      clientY: 134,
    }));
    document.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      clientX: 315,
      clientY: 234,
    }));
    document.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
    }));

    expect(panel.style.left).toBe("300px");
    expect(panel.style.top).toBe("224px");

    positionMeasures.clear();
    coordsByPos.set(mathFrom, makeCoords(200, -120, -100));
    coordsByPos.set(mathTo, makeCoords(240, -120, -80));
    autoUpdateCallbacks[0]?.();
    await flushScheduledMeasures();

    expect(positionMeasures.size).toBe(0);
    expect(panel.style.left).toBe("300px");
    expect(panel.style.top).toBe("224px");

    view.destroy();
  });

  it("does not start a polling timer while the preview is open", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    coordsByPos.set(mathFrom, makeCoords(200, 80, 100));
    coordsByPos.set(mathTo, makeCoords(240, 80, 120));

    const view = createPreviewView(doc, mathFrom + 1);
    await flushScheduledMeasures();

    const panel = view.dom.querySelector<HTMLElement>(".cf-math-preview");
    expect(panel).not.toBeNull();
    expect(setIntervalSpy).not.toHaveBeenCalled();

    view.destroy();
    setIntervalSpy.mockRestore();
  });

  it("repositions after inline math edits through the editor update path", async () => {
    coordsByPos.set(mathFrom, makeCoords(200, 80, 100));
    coordsByPos.set(mathTo, makeCoords(240, 80, 120));

    const view = createPreviewView(doc, mathFrom + 1);
    await flushScheduledMeasures();

    const panel = view.dom.querySelector<HTMLElement>(".cf-math-preview");
    expect(panel).not.toBeNull();
    expect(panel?.style.left).toBe("200px");
    expect(panel?.style.top).toBe("124px");

    const newMathTo = mathTo + 2;
    coordsByPos.delete(mathTo);
    coordsByPos.set(mathFrom, makeCoords(230, 90, 110));
    coordsByPos.set(newMathTo, makeCoords(290, 90, 130));

    view.dispatch({
      changes: { from: mathTo - 1, insert: "yz" },
      selection: { anchor: newMathTo - 1 },
    });

    expect(positionMeasures.size).toBe(1);
    expect(autoUpdateCallbacks).toHaveLength(1);
    await flushScheduledMeasures();

    expect(panel?.style.left).toBe("230px");
    expect(panel?.style.top).toBe("134px");

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

    expect(panel?.style.left).toBe("200px");
    expect(panel?.style.top).toBe("124px");

    view.destroy();
  });
});
