import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSS } from "../../constants/css-classes";

const {
  collectFootnotesMock,
  orderedFootnoteEntriesMock,
  renderDocumentFragmentToDomMock,
} = vi.hoisted(() => ({
  collectFootnotesMock: vi.fn(),
  orderedFootnoteEntriesMock: vi.fn(),
  renderDocumentFragmentToDomMock: vi.fn(),
}));

vi.mock("../../render", () => ({
  collectFootnotes: collectFootnotesMock,
  mathMacrosField: Symbol("mathMacrosField"),
}));

vi.mock("../../semantics/document", () => ({
  orderedFootnoteEntries: orderedFootnoteEntriesMock,
}));

vi.mock("../../document-surfaces", () => ({
  renderDocumentFragmentToDom: renderDocumentFragmentToDomMock,
}));

const { SidenoteMargin } = await import("./sidenote-margin");

describe("SidenoteMargin layout timing", () => {
  let host: HTMLDivElement;
  let scroller: HTMLDivElement;
  let root: Root;
  let anchorTops: Map<number, number>;
  let view: EditorView;
  let offsetHeightDescriptor: PropertyDescriptor | undefined;
  const requestAnimationFrameMock = vi.fn((_callback: FrameRequestCallback) => 1);

  beforeEach(() => {
    collectFootnotesMock.mockReset();
    orderedFootnoteEntriesMock.mockReset();
    renderDocumentFragmentToDomMock.mockReset();
    renderDocumentFragmentToDomMock.mockImplementation((container, fragment) => {
      container.textContent = fragment.text;
    });

    collectFootnotesMock.mockReturnValue({
      refs: [
        { id: "note-1", from: 10 },
        { id: "note-2", from: 20 },
      ],
    });
    orderedFootnoteEntriesMock.mockReturnValue([
      { id: "note-1", number: 1, def: { content: "h=40", from: 100 } },
      { id: "note-2", number: 2, def: { content: "h=40", from: 200 } },
    ]);

    vi.stubGlobal("requestAnimationFrame", requestAnimationFrameMock);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    requestAnimationFrameMock.mockClear();

    offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        if (this instanceof HTMLDivElement && this.classList.contains(CSS.sidenoteEntry)) {
          const match = this.textContent?.match(/h=(\d+)/);
          return match ? Number(match[1]) : 0;
        }
        return 0;
      },
    });

    host = document.createElement("div");
    scroller = document.createElement("div");
    document.body.append(host, scroller);
    root = createRoot(host);

    anchorTops = new Map([
      [10, 10],
      [20, 20],
    ]);
    view = {
      scrollDOM: scroller,
      state: {
        field: () => undefined,
      },
      lineBlockAt: (pos: number) => ({
        from: pos,
        top: anchorTops.get(pos) ?? 0,
      }),
      focus: vi.fn(),
      dispatch: vi.fn(),
    } as unknown as EditorView;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    scroller.remove();
    vi.unstubAllGlobals();
    if (offsetHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeightDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
    }
  });

  function renderMargin(invalidation: {
    revision: number;
    footnotesChanged: boolean;
    macrosChanged: boolean;
    globalLayoutChanged: boolean;
    layoutChangeFrom: number;
  }) {
    act(() => {
      root.render(createElement(SidenoteMargin, { view, invalidation }));
    });
  }

  function getEntryTops(): string[] {
    return Array.from(scroller.querySelectorAll<HTMLDivElement>(`.${CSS.sidenoteEntry}`)).map(
      (entry) => entry.style.top,
    );
  }

  it("stabilizes sidenote positions without a deferred animation-frame pass", () => {
    renderMargin({
      revision: 1,
      footnotesChanged: false,
      macrosChanged: false,
      globalLayoutChanged: false,
      layoutChangeFrom: -1,
    });

    expect(requestAnimationFrameMock).not.toHaveBeenCalled();
    expect(getEntryTops()).toEqual(["10px", "58px"]);

    anchorTops.set(10, 30);
    anchorTops.set(20, 40);

    renderMargin({
      revision: 2,
      footnotesChanged: false,
      macrosChanged: false,
      globalLayoutChanged: true,
      layoutChangeFrom: -1,
    });

    expect(requestAnimationFrameMock).not.toHaveBeenCalled();
    expect(getEntryTops()).toEqual(["30px", "78px"]);
  });
});
