import { describe, expect, it } from "vitest";
import { widgetSourceMap } from "../render/render-utils";
import {
  BlockCaptionWidget,
  BlockHeaderWidget,
} from "./plugin-render-chrome";

describe("BlockHeaderWidget", () => {
  it("updates content and refreshes source-range metadata", () => {
    const oldWidget = new BlockHeaderWidget("Theorem 1.", {});
    oldWidget.sourceFrom = 0;
    oldWidget.sourceTo = 15;
    const dom = oldWidget.toDOM();

    expect(widgetSourceMap.get(dom)).toBe(oldWidget);
    expect(dom.dataset.sourceFrom).toBe("0");
    expect(dom.dataset.sourceTo).toBe("15");

    const newWidget = new BlockHeaderWidget("Theorem 2.", {});
    newWidget.sourceFrom = 22;
    newWidget.sourceTo = 37;

    expect(newWidget.updateDOM(dom)).toBe(true);
    expect(dom.textContent).toContain("Theorem 2.");

    const mappedWidget = widgetSourceMap.get(dom);
    expect(mappedWidget).toBe(newWidget);
    expect(mappedWidget?.sourceFrom).toBe(22);
    expect(mappedWidget?.sourceTo).toBe(37);
    expect(dom.dataset.sourceFrom).toBe("22");
    expect(dom.dataset.sourceTo).toBe("37");
  });
});

describe("BlockCaptionWidget", () => {
  it("updates content and refreshes source-range metadata", () => {
    const oldWidget = new BlockCaptionWidget("Figure 1.", "Old caption", {});
    oldWidget.sourceFrom = 10;
    oldWidget.sourceTo = 21;
    const dom = oldWidget.toDOM();

    expect(widgetSourceMap.get(dom)).toBe(oldWidget);
    expect(dom.dataset.sourceFrom).toBe("10");
    expect(dom.dataset.sourceTo).toBe("21");

    const newWidget = new BlockCaptionWidget("Figure 2.", "New caption", {});
    newWidget.sourceFrom = 30;
    newWidget.sourceTo = 41;

    expect(newWidget.updateDOM(dom)).toBe(true);
    expect(dom.textContent).toContain("Figure 2.");
    expect(dom.textContent).toContain("New caption");

    const mappedWidget = widgetSourceMap.get(dom);
    expect(mappedWidget).toBe(newWidget);
    expect(mappedWidget?.sourceFrom).toBe(30);
    expect(mappedWidget?.sourceTo).toBe(41);
    expect(dom.dataset.sourceFrom).toBe("30");
    expect(dom.dataset.sourceTo).toBe("41");
  });
});
