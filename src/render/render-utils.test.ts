import { describe, expect, it } from "vitest";
import * as renderUtils from "./render-utils";

describe("render-utils compatibility barrel", () => {
  it("re-exports representative widget and decoration helpers", () => {
    expect(renderUtils.RenderWidget).toBeDefined();
    expect(renderUtils.SimpleTextRenderWidget).toBeDefined();
    expect(renderUtils.SimpleTextReferenceWidget).toBeDefined();
    expect(renderUtils.buildDecorations).toBeDefined();
    expect(renderUtils.pushWidgetDecoration).toBeDefined();
  });

  it("re-exports representative focus and plugin helpers", () => {
    expect(renderUtils.createBooleanToggleField).toBeDefined();
    expect(renderUtils.focusEffect).toBeDefined();
    expect(renderUtils.createSimpleViewPlugin).toBeDefined();
    expect(renderUtils.createDecorationsField).toBeDefined();
  });
});
