import { describe, expect, it } from "vitest";
import { type Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import {
  addMarkerReplacement,
  buildDecorations,
  decorationHidden,
  pushBlockWidgetDecoration,
  pushWidgetDecoration,
} from "./decoration-core";
import { RenderWidget } from "./source-widget";
import { getDecorationSpecs } from "../test-utils";

class TestWidget extends RenderWidget {
  constructor(readonly label: string) {
    super();
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.textContent = this.label;
    return span;
  }

  eq(other: TestWidget): boolean {
    return this.label === other.label;
  }
}

describe("addMarkerReplacement", () => {
  it("does nothing when cursorInside is true", () => {
    const items: Range<Decoration>[] = [];
    addMarkerReplacement(0, 5, true, new TestWidget("w"), items);
    expect(items).toHaveLength(0);
  });

  it("does nothing when markerFrom >= markerTo (degenerate range)", () => {
    const items: Range<Decoration>[] = [];
    addMarkerReplacement(5, 5, false, new TestWidget("w"), items);
    expect(items).toHaveLength(0);
    addMarkerReplacement(6, 5, false, new TestWidget("w"), items);
    expect(items).toHaveLength(0);
  });

  it("adds hidden mark decoration when widget is null", () => {
    const items: Range<Decoration>[] = [];
    addMarkerReplacement(0, 3, false, null, items);
    expect(items).toHaveLength(1);
    expect(items[0].from).toBe(0);
    expect(items[0].to).toBe(3);
    expect(items[0].value).toBe(decorationHidden);
  });

  it("adds replace decoration with widget when widget is provided", () => {
    const items: Range<Decoration>[] = [];
    const widget = new TestWidget("marker");
    addMarkerReplacement(0, 5, false, widget, items);

    expect(items).toHaveLength(1);
    expect(items[0].from).toBe(0);
    expect(items[0].to).toBe(5);
    expect(items[0].value.spec.widget).toBe(widget);
  });

  it("sets sourceFrom and sourceTo on the widget", () => {
    const items: Range<Decoration>[] = [];
    const widget = new TestWidget("marker");
    addMarkerReplacement(10, 20, false, widget, items);

    expect(widget.sourceFrom).toBe(10);
    expect(widget.sourceTo).toBe(20);
  });
});

describe("buildDecorations", () => {
  it("returns an empty DecorationSet for empty array", () => {
    const set = buildDecorations([]);
    expect(set).toBeDefined();
    expect(set.iter().value).toBeNull();
  });

  it("builds a DecorationSet from sorted items", () => {
    const items = [
      decorationHidden.range(0, 3),
      decorationHidden.range(5, 8),
    ];
    const set = buildDecorations(items);
    const specs = getDecorationSpecs(set);
    expect(specs).toHaveLength(2);
    expect(specs[0].from).toBe(0);
    expect(specs[1].from).toBe(5);
  });

  it("sorts items that arrive out of order", () => {
    const items = [
      decorationHidden.range(10, 15),
      decorationHidden.range(0, 5),
    ];
    const set = buildDecorations(items);
    const specs = getDecorationSpecs(set);
    expect(specs).toHaveLength(2);
    expect(specs[0].from).toBe(0);
    expect(specs[1].from).toBe(10);
  });

  it("sorts same-position decorations by startSide", () => {
    const widget = Decoration.widget({ widget: new TestWidget("w"), side: -1 }).range(0);
    const line = Decoration.line({ class: "line" }).range(0);
    expect(() => buildDecorations([widget, line])).not.toThrow();
    const specs = getDecorationSpecs(buildDecorations([widget, line]));
    expect(specs).toHaveLength(2);
  });
});

describe("pushWidgetDecoration", () => {
  it("sets sourceFrom and sourceTo on the widget", () => {
    const items: Range<Decoration>[] = [];
    const widget = new TestWidget("w");
    pushWidgetDecoration(items, widget, 10, 20);

    expect(widget.sourceFrom).toBe(10);
    expect(widget.sourceTo).toBe(20);
  });

  it("pushes a Decoration.replace range into the items array", () => {
    const items: Range<Decoration>[] = [];
    const widget = new TestWidget("w");
    pushWidgetDecoration(items, widget, 5, 15);

    expect(items).toHaveLength(1);
    expect(items[0].from).toBe(5);
    expect(items[0].to).toBe(15);
  });

  it("accumulates multiple decorations", () => {
    const items: Range<Decoration>[] = [];
    pushWidgetDecoration(items, new TestWidget("a"), 0, 5);
    pushWidgetDecoration(items, new TestWidget("b"), 10, 20);
    pushWidgetDecoration(items, new TestWidget("c"), 25, 30);

    expect(items).toHaveLength(3);
  });

  it("creates a Decoration.replace with the widget attached", () => {
    const items: Range<Decoration>[] = [];
    const widget = new TestWidget("w");
    pushWidgetDecoration(items, widget, 0, 5);

    expect(items[0].value.spec.widget).toBe(widget);
  });

  it("skips invalid replacement ranges from stale semantic positions", () => {
    const items: Range<Decoration>[] = [];
    const widget = new TestWidget("w");

    pushWidgetDecoration(items, widget, 5, 5);
    pushWidgetDecoration(items, widget, 6, 5);
    pushWidgetDecoration(items, widget, -1, 5);
    pushWidgetDecoration(items, widget, Number.NaN, 5);

    expect(items).toHaveLength(0);
    expect(widget.sourceFrom).toBe(-1);
    expect(widget.sourceTo).toBe(-1);
  });
});

describe("pushBlockWidgetDecoration", () => {
  it("sets sourceFrom and sourceTo on the widget", () => {
    const items: Range<Decoration>[] = [];
    const widget = new TestWidget("w");
    pushBlockWidgetDecoration(items, widget, 10, 20);

    expect(widget.sourceFrom).toBe(10);
    expect(widget.sourceTo).toBe(20);
  });

  it("pushes a block Decoration.replace range into the items array", () => {
    const items: Range<Decoration>[] = [];
    const widget = new TestWidget("w");
    pushBlockWidgetDecoration(items, widget, 5, 15);

    expect(items).toHaveLength(1);
    expect(items[0].from).toBe(5);
    expect(items[0].to).toBe(15);
    expect(items[0].value.spec.block).toBe(true);
    expect(items[0].value.spec.widget).toBe(widget);
  });

  it("skips invalid block replacement ranges", () => {
    const items: Range<Decoration>[] = [];

    pushBlockWidgetDecoration(items, new TestWidget("w"), 10, 10);
    pushBlockWidgetDecoration(items, new TestWidget("w"), 12, 10);

    expect(items).toHaveLength(0);
  });
});
