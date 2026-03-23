import { describe, it, expect } from "vitest";
import { Decoration } from "@codemirror/view";
import type { Range } from "@codemirror/state";
import { StateEffect } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import {
  serializeMacros,
  collectNodes,
  addMarkerReplacement,
  buildDecorations,
  createBooleanToggleField,
  RenderWidget,
  decorationHidden,
} from "./render-utils";
import {
  createEditorState,
  createTestView,
  applyStateEffects,
  getDecorationSpecs,
} from "../test-utils";

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

describe("collectNodes", () => {
  it("collects nodes of matching types from EditorState", () => {
    const state = createEditorState("# Hello\n\nworld", {
      extensions: markdown(),
    });
    const nodes = collectNodes(state, new Set(["ATXHeading1"]));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toEqual({
      type: "ATXHeading1",
      from: 0,
      to: 7,
    });
  });

  it("returns empty array when no types match", () => {
    const state = createEditorState("plain text", {
      extensions: markdown(),
    });
    const nodes = collectNodes(state, new Set(["FencedCode"]));
    expect(nodes).toHaveLength(0);
  });

  it("collects multiple matching nodes", () => {
    const state = createEditorState("# A\n\n## B\n\n### C", {
      extensions: markdown(),
    });
    const nodes = collectNodes(
      state,
      new Set(["ATXHeading1", "ATXHeading2", "ATXHeading3"]),
    );
    expect(nodes).toHaveLength(3);
    expect(nodes.map((n) => n.type)).toEqual([
      "ATXHeading1",
      "ATXHeading2",
      "ATXHeading3",
    ]);
  });

  it("works with EditorView as well as EditorState", () => {
    const view = createTestView("# Title", {
      extensions: markdown(),
    });
    const nodes = collectNodes(view, new Set(["ATXHeading1"]));
    expect(nodes).toHaveLength(1);
    view.destroy();
  });
});

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
    const widget = new TestWidget("label");
    addMarkerReplacement(0, 5, false, widget, items);
    expect(items).toHaveLength(1);
    expect(items[0].from).toBe(0);
    expect(items[0].to).toBe(5);
    expect(items[0].value.spec.widget).toBe(widget);
  });

  it("sets sourceFrom and sourceTo on the widget", () => {
    const items: Range<Decoration>[] = [];
    const widget = new TestWidget("label");
    addMarkerReplacement(10, 20, false, widget, items);
    expect(widget.sourceFrom).toBe(10);
    expect(widget.sourceTo).toBe(20);
  });
});

describe("buildDecorations", () => {
  it("returns an empty DecorationSet for empty array", () => {
    const set = buildDecorations([]);
    const specs = getDecorationSpecs(set);
    expect(specs).toHaveLength(0);
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
});

describe("createBooleanToggleField", () => {
  it("starts with the initial value (default false)", () => {
    const effect = StateEffect.define<boolean>();
    const field = createBooleanToggleField(effect);
    const state = createEditorState("", { extensions: field });
    expect(state.field(field)).toBe(false);
  });

  it("starts with custom initial value", () => {
    const effect = StateEffect.define<boolean>();
    const field = createBooleanToggleField(effect, true);
    const state = createEditorState("", { extensions: field });
    expect(state.field(field)).toBe(true);
  });

  it("updates to true when effect dispatched with true", () => {
    const effect = StateEffect.define<boolean>();
    const field = createBooleanToggleField(effect);
    const state = createEditorState("", { extensions: field });
    const updated = applyStateEffects(state, effect.of(true));
    expect(updated.field(field)).toBe(true);
  });

  it("updates to false when effect dispatched with false", () => {
    const effect = StateEffect.define<boolean>();
    const field = createBooleanToggleField(effect, true);
    const state = createEditorState("", { extensions: field });
    expect(state.field(field)).toBe(true);
    const updated = applyStateEffects(state, effect.of(false));
    expect(updated.field(field)).toBe(false);
  });

  it("preserves value when unrelated effect is dispatched", () => {
    const effect = StateEffect.define<boolean>();
    const otherEffect = StateEffect.define<boolean>();
    const field = createBooleanToggleField(effect);
    const state = createEditorState("", {
      extensions: field,
    });
    const updated = applyStateEffects(state, otherEffect.of(true));
    expect(updated.field(field)).toBe(false);
  });

  it("takes first matching effect when multiple are dispatched", () => {
    const effect = StateEffect.define<boolean>();
    const field = createBooleanToggleField(effect);
    const state = createEditorState("", { extensions: field });
    const updated = applyStateEffects(state, [
      effect.of(true),
      effect.of(false),
    ]);
    // The update loop returns on the first matching effect
    expect(updated.field(field)).toBe(true);
  });
});
