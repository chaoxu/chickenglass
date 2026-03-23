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
  createDecorationsField,
  collectNodeRangesExcludingCursor,
  defaultShouldRebuild,
  pushWidgetDecoration,
  createSimpleViewPlugin,
  defaultShouldUpdate,
  focusEffect,
  editorFocusField,
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

describe("pushWidgetDecoration", () => {
  it("sets sourceFrom and sourceTo on the widget", () => {
    const items: Range<Decoration>[] = [];
    const widget = new TestWidget("test");
    pushWidgetDecoration(items, widget, 10, 20);

    expect(widget.sourceFrom).toBe(10);
    expect(widget.sourceTo).toBe(20);
  });

  it("pushes a Decoration.replace range into the items array", () => {
    const items: Range<Decoration>[] = [];
    const widget = new TestWidget("test");
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
    expect(items[0].from).toBe(0);
    expect(items[1].from).toBe(10);
    expect(items[2].from).toBe(25);
  });

  it("creates a Decoration.replace with the widget attached", () => {
    const items: Range<Decoration>[] = [];
    const widget = new TestWidget("w");
    pushWidgetDecoration(items, widget, 0, 5);

    expect(items[0].value.spec.widget).toBe(widget);
  });
});

describe("createSimpleViewPlugin", () => {
  it("returns an Extension (non-null, non-undefined)", () => {
    const ext = createSimpleViewPlugin(() => Decoration.none);
    expect(ext).toBeDefined();
  });

  it("can be installed in an EditorView without errors", () => {
    const ext = createSimpleViewPlugin(() => Decoration.none);
    const view = createTestView("hello", { extensions: [markdown(), ext] });
    expect(view.state.doc.toString()).toBe("hello");
    view.destroy();
  });

  it("calls buildFn on construction", () => {
    let callCount = 0;
    const ext = createSimpleViewPlugin(() => {
      callCount++;
      return Decoration.none;
    });
    const view = createTestView("test", { extensions: [markdown(), ext] });
    expect(callCount).toBe(1);
    view.destroy();
  });

  it("calls buildFn on docChanged by default", () => {
    let callCount = 0;
    const ext = createSimpleViewPlugin(() => {
      callCount++;
      return Decoration.none;
    });
    const view = createTestView("test", { extensions: [markdown(), ext] });
    callCount = 0; // reset after construction
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(callCount).toBe(1);
    view.destroy();
  });

  it("accepts a custom shouldUpdate that prevents rebuilds", () => {
    let buildCount = 0;
    const ext = createSimpleViewPlugin(
      () => {
        buildCount++;
        return Decoration.none;
      },
      { shouldUpdate: () => false },
    );
    const view = createTestView("test", { extensions: [markdown(), ext] });
    buildCount = 0; // reset
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(buildCount).toBe(0);
    view.destroy();
  });

  it("accepts a custom shouldUpdate that always rebuilds", () => {
    let buildCount = 0;
    const ext = createSimpleViewPlugin(
      () => {
        buildCount++;
        return Decoration.none;
      },
      { shouldUpdate: () => true },
    );
    const view = createTestView("test", { extensions: [markdown(), ext] });
    buildCount = 0;
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(buildCount).toBe(1);
    view.destroy();
  });
});

describe("defaultShouldUpdate", () => {
  it("is a function", () => {
    expect(typeof defaultShouldUpdate).toBe("function");
  });
});

describe("createDecorationsField", () => {
  it("calls builder on create and provides decorations", () => {
    let callCount = 0;
    const field = createDecorationsField(() => {
      callCount++;
      return Decoration.none;
    });
    const state = createEditorState("hello", { extensions: [markdown(), field] });
    expect(callCount).toBe(1);
    expect(state.field(field)).toBe(Decoration.none);
  });

  it("rebuilds when document changes (default predicate)", () => {
    let callCount = 0;
    const field = createDecorationsField(() => {
      callCount++;
      return Decoration.none;
    });
    const state = createEditorState("hello", {
      extensions: [markdown(), editorFocusField, field],
    });
    callCount = 0;
    const updated = state.update({ changes: { from: 0, insert: "x" } }).state;
    expect(callCount).toBe(1);
    expect(updated.field(field)).toBe(Decoration.none);
  });

  it("rebuilds when selection changes (default predicate)", () => {
    let callCount = 0;
    const field = createDecorationsField(() => {
      callCount++;
      return Decoration.none;
    });
    const state = createEditorState("hello world", {
      extensions: [markdown(), editorFocusField, field],
    });
    callCount = 0;
    const updated = state.update({ selection: { anchor: 5 } }).state;
    expect(callCount).toBe(1);
    expect(updated.field(field)).toBe(Decoration.none);
  });

  it("rebuilds when focusEffect is dispatched (default predicate)", () => {
    let callCount = 0;
    const field = createDecorationsField(() => {
      callCount++;
      return Decoration.none;
    });
    const state = createEditorState("hello", {
      extensions: [markdown(), editorFocusField, field],
    });
    callCount = 0;
    const updated = state.update({ effects: focusEffect.of(true) }).state;
    expect(callCount).toBe(1);
    expect(updated.field(field)).toBe(Decoration.none);
  });

  it("does not rebuild on unrelated effect (default predicate)", () => {
    let callCount = 0;
    const otherEffect = StateEffect.define<boolean>();
    const field = createDecorationsField(() => {
      callCount++;
      return Decoration.none;
    });
    const state = createEditorState("hello", {
      extensions: [markdown(), editorFocusField, field],
    });
    callCount = 0;
    const unchanged = state.update({ effects: otherEffect.of(true) }).state;
    expect(callCount).toBe(0);
    expect(unchanged.field(field)).toBe(Decoration.none);
  });

  it("accepts a custom shouldRebuild predicate", () => {
    const customEffect = StateEffect.define<boolean>();
    let callCount = 0;
    const field = createDecorationsField(
      () => {
        callCount++;
        return Decoration.none;
      },
      (tr) => tr.effects.some((e) => e.is(customEffect)),
    );
    const state = createEditorState("hello", { extensions: [markdown(), field] });
    callCount = 0;

    // Doc change should NOT trigger rebuild with custom predicate
    const afterDoc = state.update({ changes: { from: 0, insert: "x" } }).state;
    expect(callCount).toBe(0);
    expect(afterDoc.field(field)).toBe(Decoration.none);

    // Custom effect should trigger rebuild
    const afterEffect = state.update({ effects: customEffect.of(true) }).state;
    expect(callCount).toBe(1);
    expect(afterEffect.field(field)).toBe(Decoration.none);
  });

  it("provides decorations to EditorView.decorations facet", () => {
    const lineDeco = Decoration.line({ class: "test-line" });
    const field = createDecorationsField(() => {
      return Decoration.set([lineDeco.range(0)]);
    });
    const view = createTestView("hello", { extensions: [markdown(), field] });
    const specs = getDecorationSpecs(view.state.field(field));
    expect(specs).toHaveLength(1);
    expect(specs[0].class).toBe("test-line");
    view.destroy();
  });
});

describe("defaultShouldRebuild", () => {
  it("returns true on docChanged", () => {
    const field = editorFocusField;
    const state = createEditorState("hello", { extensions: [markdown(), field] });
    const tr = state.update({ changes: { from: 0, insert: "x" } });
    expect(defaultShouldRebuild(tr)).toBe(true);
  });

  it("returns true on selection change", () => {
    const field = editorFocusField;
    const state = createEditorState("hello world", { extensions: [markdown(), field] });
    const tr = state.update({ selection: { anchor: 5 } });
    expect(defaultShouldRebuild(tr)).toBe(true);
  });

  it("returns true on focusEffect", () => {
    const field = editorFocusField;
    const state = createEditorState("hello", { extensions: [markdown(), field] });
    const tr = state.update({ effects: focusEffect.of(true) });
    expect(defaultShouldRebuild(tr)).toBe(true);
  });

  it("returns false on unrelated transaction", () => {
    const otherEffect = StateEffect.define<boolean>();
    const field = editorFocusField;
    const state = createEditorState("hello", { extensions: [markdown(), field] });
    const tr = state.update({ effects: otherEffect.of(true) });
    expect(defaultShouldRebuild(tr)).toBe(false);
  });
});

describe("collectNodeRangesExcludingCursor", () => {
  it("collects matching nodes and calls buildItem for each", () => {
    const nodeTypes = new Set(["ATXHeading1"]);
    const view = createTestView("# Hello\n\nworld", {
      extensions: markdown(),
      cursorPos: 14, // cursor at end (outside heading)
    });

    const items = collectNodeRangesExcludingCursor(view, nodeTypes, (node, acc) => {
      acc.push(decorationHidden.range(node.from, node.to));
    });

    expect(items).toHaveLength(1);
    expect(items[0].from).toBe(0);
    expect(items[0].to).toBe(7);
    view.destroy();
  });

  it("skips nodes where cursor is inside", () => {
    const nodeTypes = new Set(["ATXHeading1"]);
    const view = createTestView("# Hello\n\nworld", {
      extensions: markdown(),
      cursorPos: 3, // cursor inside heading
    });

    const items = collectNodeRangesExcludingCursor(view, nodeTypes, (node, acc) => {
      acc.push(decorationHidden.range(node.from, node.to));
    });

    expect(items).toHaveLength(0);
    view.destroy();
  });

  it("ignores non-matching node types", () => {
    const nodeTypes = new Set(["FencedCode"]);
    const view = createTestView("# Hello\n\nworld", {
      extensions: markdown(),
      cursorPos: 14,
    });

    const items = collectNodeRangesExcludingCursor(view, nodeTypes, (node, acc) => {
      acc.push(decorationHidden.range(node.from, node.to));
    });

    expect(items).toHaveLength(0);
    view.destroy();
  });

  it("collects multiple nodes of different types", () => {
    const nodeTypes = new Set(["Emphasis", "StrongEmphasis"]);
    // Place cursor well outside both emphasis nodes:
    // *em*(0-4) and(5-8) **bold**(9-17)
    const view = createTestView("*em* and **bold** trailing", {
      extensions: markdown(),
      cursorPos: 25, // cursor in "trailing", outside both nodes
    });

    const collected: string[] = [];
    collectNodeRangesExcludingCursor(view, nodeTypes, (node) => {
      collected.push(node.type.name);
    });

    expect(collected).toContain("Emphasis");
    expect(collected).toContain("StrongEmphasis");
    view.destroy();
  });

  it("passes SyntaxNodeRef with accessible .node property", () => {
    const nodeTypes = new Set(["ATXHeading1"]);
    const view = createTestView("# Hello\n\nworld", {
      extensions: markdown(),
      cursorPos: 14,
    });

    let hadNodeAccess = false;
    collectNodeRangesExcludingCursor(view, nodeTypes, (node) => {
      // SyntaxNodeRef should have a .node property for child access
      hadNodeAccess = node.node !== undefined;
    });

    expect(hadNodeAccess).toBe(true);
    view.destroy();
  });

  it("returns false from buildItem to prevent descending into children", () => {
    const nodeTypes = new Set(["ATXHeading1", "HeaderMark"]);
    const view = createTestView("# Hello\n\nworld", {
      extensions: markdown(),
      cursorPos: 14,
    });

    const collected: string[] = [];
    collectNodeRangesExcludingCursor(view, nodeTypes, (node) => {
      collected.push(node.type.name);
      return false; // don't descend
    });

    // Should only get ATXHeading1, not HeaderMark (which is a child)
    expect(collected).toEqual(["ATXHeading1"]);
    view.destroy();
  });
});
