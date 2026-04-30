import { type Range } from "@codemirror/state";
import {
  Decoration,
  WidgetType,
} from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  addPluginMarkerReplacement,
  type PluginRenderWidget,
  pushPluginHiddenDecoration,
  pushPluginWidgetDecoration,
} from "./plugin-render-adapter";

class TestPluginWidget extends WidgetType implements PluginRenderWidget {
  sourceFrom = -1;
  sourceTo = -1;
  useLiveSourceRange = false;

  constructor(readonly label: string) {
    super();
  }

  updateSourceRange(from: number, to: number): void {
    this.sourceFrom = from;
    this.sourceTo = to;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.textContent = this.label;
    return el;
  }

  eq(other: WidgetType): boolean {
    return other instanceof TestPluginWidget && other.label === this.label;
  }
}

function firstSpec(items: readonly Range<Decoration>[]) {
  const first = items[0];
  if (!first) throw new Error("expected a decoration range");
  return first.value.spec;
}

describe("plugin render adapter helpers", () => {
  it("replaces hidden plugin markers with source-range-aware widgets", () => {
    const items: Range<Decoration>[] = [];
    const widget = new TestPluginWidget("Theorem");

    addPluginMarkerReplacement(2, 12, false, widget, items);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ from: 2, to: 12 });
    expect(firstSpec(items).widget).toBe(widget);
    expect(widget.sourceFrom).toBe(2);
    expect(widget.sourceTo).toBe(12);
  });

  it("leaves the marker visible while the cursor is inside it", () => {
    const items: Range<Decoration>[] = [];
    const widget = new TestPluginWidget("Theorem");

    addPluginMarkerReplacement(2, 12, true, widget, items);

    expect(items).toEqual([]);
    expect(widget.sourceFrom).toBe(-1);
    expect(widget.sourceTo).toBe(-1);
  });

  it("hides plugin source ranges without depending on render widgets", () => {
    const items: Range<Decoration>[] = [];

    pushPluginHiddenDecoration(items, 5, 9);

    expect(items[0]).toMatchObject({ from: 5, to: 9 });
    expect(firstSpec(items).class).toBeUndefined();
    expect(firstSpec(items).widget).toBeUndefined();
  });

  it("updates widget source ranges before publishing widget decorations", () => {
    const items: Range<Decoration>[] = [];
    const widget = new TestPluginWidget("Caption");

    pushPluginWidgetDecoration(items, widget, 20, 35);

    expect(items[0]).toMatchObject({ from: 20, to: 35 });
    expect(firstSpec(items).widget).toBe(widget);
    expect(widget.sourceFrom).toBe(20);
    expect(widget.sourceTo).toBe(35);
  });
});
