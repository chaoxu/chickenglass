import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMarkdownLanguageExtensions,
  sharedDocumentStateExtensions,
} from "../editor/base-editor-extensions";
import { documentAnalysisField } from "../semantics/codemirror-source";
import { mathMacrosField } from "./math-macros";

const computePositionMock = vi.fn();
const autoUpdateMock = vi.fn();

vi.mock("@floating-ui/dom", () => ({
  autoUpdate: (...args: unknown[]) => autoUpdateMock(...args),
  computePosition: (...args: unknown[]) => computePositionMock(...args),
  offset: (value: number) => ({ name: "offset", options: value }),
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
  await Promise.resolve();
}

describe("math preview positioning", () => {
  const doc = "a $x$ b";
  const mathFrom = doc.indexOf("$");
  const mathTo = mathFrom + "$x$".length;
  const coordsByPos = new Map<number, PositionRect>();
  const autoUpdateCallbacks: Array<() => void> = [];
  let cleanupAutoUpdate = vi.fn();
  let hasFocusSpy: ReturnType<typeof vi.spyOn>;
  let coordsAtPosSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    coordsByPos.clear();
    autoUpdateCallbacks.length = 0;
    cleanupAutoUpdate = vi.fn();
    computePositionMock.mockReset();
    autoUpdateMock.mockReset();

    hasFocusSpy = vi.spyOn(EditorView.prototype, "hasFocus", "get").mockReturnValue(true);
    coordsAtPosSpy = vi.spyOn(EditorView.prototype, "coordsAtPos").mockImplementation((pos) => {
      return coordsByPos.get(pos) ?? null;
    });

    computePositionMock.mockImplementation((reference: { getBoundingClientRect: () => PositionRect }) => {
      const rect = reference.getBoundingClientRect();
      return Promise.resolve({
        x: rect.left,
        y: rect.bottom + 4,
      });
    });

    autoUpdateMock.mockImplementation((_reference: unknown, _floating: unknown, update: () => void) => {
      autoUpdateCallbacks.push(update);
      update();
      return cleanupAutoUpdate;
    });
  });

  afterEach(() => {
    hasFocusSpy.mockRestore();
    coordsAtPosSpy.mockRestore();
    document.body.innerHTML = "";
  });

  it("recomputes the preview position from fresh math coords on auto-update", async () => {
    coordsByPos.set(mathFrom, makeCoords(200, 80, 100));
    coordsByPos.set(mathTo, makeCoords(240, 80, 120));

    const view = createPreviewView(doc, mathFrom + 1);
    await flushPositioning();

    const panel = view.dom.querySelector<HTMLElement>(".cf-math-preview");
    expect(panel).not.toBeNull();
    expect(panel?.style.left).toBe("200px");
    expect(panel?.style.top).toBe("124px");
    expect(autoUpdateCallbacks).toHaveLength(1);
    expect(computePositionMock).toHaveBeenCalled();
    expect(computePositionMock.mock.calls[0]?.[2]).toMatchObject({
      placement: "bottom-start",
      strategy: "fixed",
    });

    coordsByPos.set(mathFrom, makeCoords(200, -120, -100));
    coordsByPos.set(mathTo, makeCoords(240, -120, -80));
    autoUpdateCallbacks[0]();
    await flushPositioning();

    expect(panel?.style.left).toBe("200px");
    expect(panel?.style.top).toBe("-76px");

    const latestReference = computePositionMock.mock.calls.at(-1)?.[0] as {
      getBoundingClientRect: () => PositionRect;
    };
    expect(latestReference.getBoundingClientRect().bottom).toBe(-80);

    view.destroy();
    expect(cleanupAutoUpdate).toHaveBeenCalledTimes(1);
  });

  it("preserves a manual drag as an override for later auto-updates", async () => {
    coordsByPos.set(mathFrom, makeCoords(200, 80, 100));
    coordsByPos.set(mathTo, makeCoords(240, 80, 120));

    const view = createPreviewView(doc, mathFrom + 1);
    await flushPositioning();

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

    const callCountBeforeScroll = computePositionMock.mock.calls.length;
    coordsByPos.set(mathFrom, makeCoords(200, -120, -100));
    coordsByPos.set(mathTo, makeCoords(240, -120, -80));
    autoUpdateCallbacks[0]();
    await flushPositioning();

    expect(computePositionMock.mock.calls.length).toBe(callCountBeforeScroll);
    expect(panel.style.left).toBe("300px");
    expect(panel.style.top).toBe("224px");

    view.destroy();
  });
});
