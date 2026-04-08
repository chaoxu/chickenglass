import { describe, expect, it, vi } from "vitest";
import {
  BaseRenderWidget,
  cloneRenderedHTMLElement,
} from "./widget-core";
import {
  serializeMacros,
  SimpleTextRenderWidget,
} from "./source-widget";

class CachedTestWidget extends BaseRenderWidget {
  buildCount = 0;

  constructor(readonly label: string) {
    super();
  }

  createDOM(): HTMLElement {
    return this.createCachedDOM(() => {
      this.buildCount += 1;
      const span = document.createElement("span");
      span.textContent = this.label;
      return span;
    });
  }

  eq(other: CachedTestWidget): boolean {
    return this.label === other.label;
  }
}

describe("serializeMacros", () => {
  it("returns empty string for empty object", () => {
    expect(serializeMacros({})).toBe("");
  });

  it("serializes a single macro", () => {
    expect(serializeMacros({ "\\R": "\\mathbb{R}" })).toBe(
      "\\R=\\mathbb{R}",
    );
  });

  it("serializes multiple macros sorted by key", () => {
    const result = serializeMacros({
      "\\Z": "\\mathbb{Z}",
      "\\N": "\\mathbb{N}",
      "\\R": "\\mathbb{R}",
    });
    expect(result).toBe(
      "\\N=\\mathbb{N}\0\\R=\\mathbb{R}\0\\Z=\\mathbb{Z}",
    );
  });

  it("produces the same string regardless of insertion order", () => {
    const a = serializeMacros({ "\\a": "1", "\\b": "2" });
    const b = serializeMacros({ "\\b": "2", "\\a": "1" });
    expect(a).toBe(b);
  });
});

describe("SimpleTextRenderWidget", () => {
  it("renders a text element with attrs", () => {
    const widget = new SimpleTextRenderWidget({
      tagName: "sup",
      className: "cf-test",
      text: "7",
      attrs: { "data-footnote-id": "fn-7" },
    });

    const el = widget.toDOM();
    expect(el.tagName).toBe("SUP");
    expect(el.className).toBe("cf-test");
    expect(el.textContent).toBe("7");
    expect(el.getAttribute("data-footnote-id")).toBe("fn-7");
  });

  it("compares equality by rendered text spec", () => {
    const left = new SimpleTextRenderWidget({
      tagName: "span",
      className: "cf-label",
      text: "demo",
    });
    const right = new SimpleTextRenderWidget({
      tagName: "span",
      className: "cf-label",
      text: "demo",
    });
    const different = new SimpleTextRenderWidget({
      tagName: "span",
      className: "cf-label-active",
      text: "demo",
    });

    expect(left.eq(right)).toBe(true);
    expect(left.eq(different)).toBe(false);
  });
});

describe("RenderWidget DOM cache", () => {
  it("reuses a pristine cached DOM snapshot across repeated renders", () => {
    const widget = new CachedTestWidget("cached");

    const first = widget.toDOM();
    first.textContent = "mutated";
    const second = widget.toDOM();

    expect(widget.buildCount).toBe(1);
    expect(second).not.toBe(first);
    expect(second.textContent).toBe("cached");
  });
});

describe("cloneRenderedHTMLElement", () => {
  it("copies nested canvas bitmaps onto the cloned tree", () => {
    const drawImage = vi.fn();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      { drawImage } as unknown as CanvasRenderingContext2D,
    );

    const wrapper = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 18;
    wrapper.appendChild(canvas);

    const clone = cloneRenderedHTMLElement(wrapper);
    const clonedCanvas = clone.querySelector("canvas");

    expect(clonedCanvas).not.toBeNull();
    expect(clonedCanvas?.width).toBe(32);
    expect(clonedCanvas?.height).toBe(18);
    expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0);

    getContext.mockRestore();
  });
});
