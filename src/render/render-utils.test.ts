import { describe, it, expect, afterEach, vi } from "vitest";
import { Decoration, type DecorationSet, type ViewPlugin } from "@codemirror/view";
import type { Range, EditorState } from "@codemirror/state";
import { StateEffect } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import {
  serializeMacros,
  collectNodes,
  addMarkerReplacement,
  buildDecorations,
  createBooleanToggleField,
  createDecorationsField,
  collectNodeRangesExcludingCursor,
  defaultShouldRebuild,
  cursorSensitiveShouldRebuild,
  pushWidgetDecoration,
  createSimpleViewPlugin,
  createCursorSensitiveViewPlugin,
  diffVisibleRanges,
  defaultShouldUpdate,
  cursorSensitiveShouldUpdate,
  focusEffect,
  editorFocusField,
  RenderWidget,
  SimpleTextRenderWidget,
  cloneRenderedHTMLElement,
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
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

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
    view = createTestView("# Title", {
      extensions: markdown(),
    });
    const nodes = collectNodes(view, new Set(["ATXHeading1"]));
    expect(nodes).toHaveLength(1);
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

class CachedTestWidget extends RenderWidget {
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

  it("sorts same-position decorations by startSide", () => {
    const line = Decoration.line({ class: "cf-line" }).range(5);
    const widget = Decoration.widget({
      widget: new TestWidget("include"),
    }).range(5);

    expect(() => buildDecorations([widget, line])).not.toThrow();
    const specs = getDecorationSpecs(buildDecorations([widget, line]));
    expect(specs).toHaveLength(2);
    expect(specs[0].from).toBe(5);
    expect(specs[1].from).toBe(5);
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
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("returns an Extension (non-null, non-undefined)", () => {
    const ext = createSimpleViewPlugin(() => Decoration.none);
    expect(ext).toBeDefined();
  });

  it("can be installed in an EditorView without errors", () => {
    const ext = createSimpleViewPlugin(() => Decoration.none);
    view = createTestView("hello", { extensions: [markdown(), ext] });
    expect(view.state.doc.toString()).toBe("hello");
  });

  it("calls buildFn on construction", () => {
    let callCount = 0;
    const ext = createSimpleViewPlugin(() => {
      callCount++;
      return Decoration.none;
    });
    view = createTestView("test", { extensions: [markdown(), ext] });
    expect(callCount).toBe(1);
  });

  it("calls buildFn on docChanged by default", () => {
    let callCount = 0;
    const ext = createSimpleViewPlugin(() => {
      callCount++;
      return Decoration.none;
    });
    view = createTestView("test", { extensions: [markdown(), ext] });
    callCount = 0; // reset after construction
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(callCount).toBe(1);
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
    view = createTestView("test", { extensions: [markdown(), ext] });
    buildCount = 0; // reset
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(buildCount).toBe(0);
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
    view = createTestView("test", { extensions: [markdown(), ext] });
    buildCount = 0;
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(buildCount).toBe(1);
  });
});

/**
 * Build a minimal ViewUpdate stub for testing shouldUpdate predicates.
 *
 * When `state` and `startState` are the same reference, syntaxTree identity
 * comparison returns true (no tree change). Pass different EditorState
 * instances to simulate a tree change.
 */
function mockViewUpdate(overrides: Partial<{
  docChanged: boolean;
  selectionSet: boolean;
  focusChanged: boolean;
  viewportChanged: boolean;
  state: EditorState;
  startState: EditorState;
}> = {}): ViewUpdate {
  const state = overrides.state ?? createEditorState("test", { extensions: [markdown()] });
  return {
    docChanged: overrides.docChanged ?? false,
    selectionSet: overrides.selectionSet ?? false,
    focusChanged: overrides.focusChanged ?? false,
    viewportChanged: overrides.viewportChanged ?? false,
    state: overrides.state ?? state,
    startState: overrides.startState ?? state,
  } as unknown as ViewUpdate;
}

describe("defaultShouldUpdate", () => {
  it("returns true when docChanged", () => {
    expect(defaultShouldUpdate(mockViewUpdate({ docChanged: true }))).toBe(true);
  });

  it("returns true when syntax tree changed", () => {
    const state1 = createEditorState("hello", { extensions: [markdown()] });
    const state2 = createEditorState("hello world", { extensions: [markdown()] });
    expect(defaultShouldUpdate(mockViewUpdate({ state: state2, startState: state1 }))).toBe(true);
  });

  it("returns false when only viewportChanged (#577)", () => {
    expect(defaultShouldUpdate(mockViewUpdate({ viewportChanged: true }))).toBe(false);
  });

  it("returns false when only selectionSet", () => {
    expect(defaultShouldUpdate(mockViewUpdate({ selectionSet: true }))).toBe(false);
  });

  it("returns false when only focusChanged", () => {
    expect(defaultShouldUpdate(mockViewUpdate({ focusChanged: true }))).toBe(false);
  });

  it("returns false when nothing changed", () => {
    expect(defaultShouldUpdate(mockViewUpdate())).toBe(false);
  });
});

describe("cursorSensitiveShouldUpdate", () => {
  it("returns true when docChanged", () => {
    expect(cursorSensitiveShouldUpdate(mockViewUpdate({ docChanged: true }))).toBe(true);
  });

  it("returns true when selectionSet", () => {
    expect(cursorSensitiveShouldUpdate(mockViewUpdate({ selectionSet: true }))).toBe(true);
  });

  it("returns true when focusChanged", () => {
    expect(cursorSensitiveShouldUpdate(mockViewUpdate({ focusChanged: true }))).toBe(true);
  });

  it("returns true when viewportChanged (opt-in for visibleRanges plugins)", () => {
    expect(cursorSensitiveShouldUpdate(mockViewUpdate({ viewportChanged: true }))).toBe(true);
  });

  it("returns true when syntax tree changed", () => {
    const state1 = createEditorState("hello", { extensions: [markdown()] });
    const state2 = createEditorState("hello world", { extensions: [markdown()] });
    expect(cursorSensitiveShouldUpdate(mockViewUpdate({ state: state2, startState: state1 }))).toBe(true);
  });

  it("returns false when nothing changed", () => {
    expect(cursorSensitiveShouldUpdate(mockViewUpdate())).toBe(false);
  });
});

describe("createDecorationsField", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

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

  // After #443: default predicate is structural-only (doc + tree).
  // Selection and focus no longer trigger rebuilds by default.
  it("does NOT rebuild when selection changes (structural-only default, #443)", () => {
    let callCount = 0;
    const field = createDecorationsField(() => {
      callCount++;
      return Decoration.none;
    });
    const state = createEditorState("hello world", {
      extensions: [markdown(), editorFocusField, field],
    });
    callCount = 0;
    void state.update({ selection: { anchor: 5 } });
    expect(callCount).toBe(0);
  });

  it("does NOT rebuild when focusEffect is dispatched (structural-only default, #443)", () => {
    let callCount = 0;
    const field = createDecorationsField(() => {
      callCount++;
      return Decoration.none;
    });
    const state = createEditorState("hello", {
      extensions: [markdown(), editorFocusField, field],
    });
    callCount = 0;
    void state.update({ effects: focusEffect.of(true) });
    expect(callCount).toBe(0);
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
    view = createTestView("hello", { extensions: [markdown(), field] });
    const specs = getDecorationSpecs(view.state.field(field));
    expect(specs).toHaveLength(1);
    expect(specs[0].class).toBe("test-line");
  });

  // ── mapOnDocChanged (#718) ──────────────────────────────────────────

  /** Iterate a DecorationSet into an array of {from, to} for position checks. */
  function* iterDecos(decoSet: DecorationSet) {
    const iter = decoSet.iter();
    while (iter.value) {
      yield { from: iter.from, to: iter.to };
      iter.next();
    }
  }

  it("maps decorations instead of rebuilding when mapOnDocChanged is true and predicate returns false", () => {
    const lineDeco = Decoration.line({ class: "test-mapped" });
    let buildCount = 0;
    const field = createDecorationsField(
      (s) => {
        buildCount++;
        // Place a line decoration at start of line 2
        if (s.doc.lines >= 2) {
          return Decoration.set([lineDeco.range(s.doc.line(2).from)]);
        }
        return Decoration.none;
      },
      () => false, // never rebuild — force mapping path
      true, // mapOnDocChanged
    );
    const state = createEditorState("first\nsecond", { extensions: [field] });
    expect(buildCount).toBe(1); // initial build

    // Decoration at start of "second" = position 6
    const iter1 = state.field(field).iter();
    expect(iter1.from).toBe(6);

    buildCount = 0;
    // Insert "XX" at beginning — shifts all positions by 2
    const edited = state.update({ changes: { from: 0, insert: "XX" } }).state;

    expect(buildCount).toBe(0); // builder was NOT called
    const iter2 = edited.field(field).iter();
    expect(iter2.from).toBe(8); // 6 + 2 = correctly mapped
  });

  it("rebuilds when predicate fires even with mapOnDocChanged enabled", () => {
    let buildCount = 0;
    const field = createDecorationsField(
      () => {
        buildCount++;
        return Decoration.none;
      },
      () => true, // always rebuild
      true,
    );
    const state = createEditorState("hello", { extensions: [field] });
    buildCount = 0;
    const edited = state.update({ changes: { from: 0, insert: "X" } }).state;
    edited.field(field); // access the field to trigger evaluation
    expect(buildCount).toBe(1); // builder WAS called despite mapOnDocChanged
  });

  it("mapped decorations survive deletion without corruption (#718)", () => {
    const lineDeco = Decoration.line({ class: "test-del" });
    const field = createDecorationsField(
      (s) => {
        // Decorations on every line
        const items: Range<Decoration>[] = [];
        for (let i = 1; i <= s.doc.lines; i++) {
          items.push(lineDeco.range(s.doc.line(i).from));
        }
        return Decoration.set(items);
      },
      () => false, // force mapping path
      true,
    );
    const state = createEditorState("aaa\nbbb\nccc", { extensions: [field] });
    // Positions: line1=0, line2=4, line3=8
    const before = [...iterDecos(state.field(field))];
    expect(before.map((d) => d.from)).toEqual([0, 4, 8]);

    // Delete "aaa\n" (positions 0-4) — removes line 1, shifts rest by -4
    const edited = state.update({ changes: { from: 0, to: 4 } }).state;
    const after = [...iterDecos(edited.field(field))];
    expect(after.map((d) => d.from)).toEqual([0, 4]); // mapped: bbb=0, ccc=4
  });

  it("does not map when docChanged is false with mapOnDocChanged enabled", () => {
    let buildCount = 0;
    const field = createDecorationsField(
      () => {
        buildCount++;
        return Decoration.none;
      },
      () => false, // never rebuild
      true,
    );
    const state = createEditorState("hello", { extensions: [field] });
    buildCount = 0;
    // Selection-only change — no doc change, no rebuild, no map
    const updated = state.update({ selection: { anchor: 3 } }).state;
    expect(buildCount).toBe(0);
    expect(updated.field(field)).toBe(state.field(field)); // same reference
  });
});

describe("defaultShouldRebuild", () => {
  it("returns true on docChanged", () => {
    const field = editorFocusField;
    const state = createEditorState("hello", { extensions: [markdown(), field] });
    const tr = state.update({ changes: { from: 0, insert: "x" } });
    expect(defaultShouldRebuild(tr)).toBe(true);
  });

  // After #443: defaultShouldRebuild is structural-only (doc + tree).
  // Selection and focus changes no longer trigger structural rebuilds.
  it("returns false on selection change (structural-only, #443)", () => {
    const field = editorFocusField;
    const state = createEditorState("hello world", { extensions: [markdown(), field] });
    const tr = state.update({ selection: { anchor: 5 } });
    expect(defaultShouldRebuild(tr)).toBe(false);
  });

  it("returns false on focusEffect (structural-only, #443)", () => {
    const field = editorFocusField;
    const state = createEditorState("hello", { extensions: [markdown(), field] });
    const tr = state.update({ effects: focusEffect.of(true) });
    expect(defaultShouldRebuild(tr)).toBe(false);
  });

  it("returns false on unrelated transaction", () => {
    const otherEffect = StateEffect.define<boolean>();
    const field = editorFocusField;
    const state = createEditorState("hello", { extensions: [markdown(), field] });
    const tr = state.update({ effects: otherEffect.of(true) });
    expect(defaultShouldRebuild(tr)).toBe(false);
  });
});

describe("cursorSensitiveShouldRebuild", () => {
  it("returns true on docChanged", () => {
    const field = editorFocusField;
    const state = createEditorState("hello", { extensions: [markdown(), field] });
    const tr = state.update({ changes: { from: 0, insert: "x" } });
    expect(cursorSensitiveShouldRebuild(tr)).toBe(true);
  });

  it("returns true on selection change", () => {
    const field = editorFocusField;
    const state = createEditorState("hello world", { extensions: [markdown(), field] });
    const tr = state.update({ selection: { anchor: 5 } });
    expect(cursorSensitiveShouldRebuild(tr)).toBe(true);
  });

  it("returns true on focusEffect", () => {
    const field = editorFocusField;
    const state = createEditorState("hello", { extensions: [markdown(), field] });
    const tr = state.update({ effects: focusEffect.of(true) });
    expect(cursorSensitiveShouldRebuild(tr)).toBe(true);
  });

  it("returns false on unrelated transaction", () => {
    const otherEffect = StateEffect.define<boolean>();
    const field = editorFocusField;
    const state = createEditorState("hello", { extensions: [markdown(), field] });
    const tr = state.update({ effects: otherEffect.of(true) });
    expect(cursorSensitiveShouldRebuild(tr)).toBe(false);
  });
});

describe("collectNodeRangesExcludingCursor", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("collects matching nodes and calls buildItem for each", () => {
    const nodeTypes = new Set(["ATXHeading1"]);
    view = createTestView("# Hello\n\nworld", {
      extensions: markdown(),
      cursorPos: 14, // cursor at end (outside heading)
    });

    const items = collectNodeRangesExcludingCursor(view, nodeTypes, (node, acc) => {
      acc.push(decorationHidden.range(node.from, node.to));
    });

    expect(items).toHaveLength(1);
    expect(items[0].from).toBe(0);
    expect(items[0].to).toBe(7);
  });

  it("skips nodes where cursor is inside", () => {
    const nodeTypes = new Set(["ATXHeading1"]);
    view = createTestView("# Hello\n\nworld", {
      extensions: markdown(),
      cursorPos: 3, // cursor inside heading
    });

    const items = collectNodeRangesExcludingCursor(view, nodeTypes, (node, acc) => {
      acc.push(decorationHidden.range(node.from, node.to));
    });

    expect(items).toHaveLength(0);
  });

  it("ignores non-matching node types", () => {
    const nodeTypes = new Set(["FencedCode"]);
    view = createTestView("# Hello\n\nworld", {
      extensions: markdown(),
      cursorPos: 14,
    });

    const items = collectNodeRangesExcludingCursor(view, nodeTypes, (node, acc) => {
      acc.push(decorationHidden.range(node.from, node.to));
    });

    expect(items).toHaveLength(0);
  });

  it("collects multiple nodes of different types", () => {
    const nodeTypes = new Set(["Emphasis", "StrongEmphasis"]);
    // Place cursor well outside both emphasis nodes:
    // *em*(0-4) and(5-8) **bold**(9-17)
    view = createTestView("*em* and **bold** trailing", {
      extensions: markdown(),
      cursorPos: 25, // cursor in "trailing", outside both nodes
    });

    const collected: string[] = [];
    collectNodeRangesExcludingCursor(view, nodeTypes, (node) => {
      collected.push(node.type.name);
    });

    expect(collected).toContain("Emphasis");
    expect(collected).toContain("StrongEmphasis");
  });

  it("passes SyntaxNodeRef with accessible .node property", () => {
    const nodeTypes = new Set(["ATXHeading1"]);
    view = createTestView("# Hello\n\nworld", {
      extensions: markdown(),
      cursorPos: 14,
    });

    let hadNodeAccess = false;
    collectNodeRangesExcludingCursor(view, nodeTypes, (node) => {
      // SyntaxNodeRef should have a .node property for child access
      hadNodeAccess = node.node !== undefined;
    });

    expect(hadNodeAccess).toBe(true);
  });

  it("returns false from buildItem to prevent descending into children", () => {
    const nodeTypes = new Set(["ATXHeading1", "HeaderMark"]);
    view = createTestView("# Hello\n\nworld", {
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
  });

  it("respects custom ranges parameter", () => {
    const nodeTypes = new Set(["ATXHeading1"]);
    // "# A" at 0-3, "# B" at 5-8  (newline at 3-4, newline at 8-9)
    view = createTestView("# A\n# B\nend", {
      extensions: markdown(),
      cursorPos: 10, // cursor at "end"
    });

    // Only iterate range covering the second heading
    const collected: number[] = [];
    collectNodeRangesExcludingCursor(view, nodeTypes, (node) => {
      collected.push(node.from);
    }, { ranges: [{ from: 4, to: 8 }] });

    expect(collected).toEqual([4]);
  });

  it("respects skip predicate", () => {
    const nodeTypes = new Set(["ATXHeading1"]);
    view = createTestView("# A\n# B\nend", {
      extensions: markdown(),
      cursorPos: 10,
    });

    // Skip nodes that start before position 4
    const collected: number[] = [];
    collectNodeRangesExcludingCursor(view, nodeTypes, (node) => {
      collected.push(node.from);
    }, { skip: (pos) => pos < 4 });

    expect(collected).toEqual([4]);
  });
});

describe("diffVisibleRanges", () => {
  it("returns empty when new ranges are a subset of old", () => {
    expect(diffVisibleRanges([{ from: 0, to: 2000 }], [{ from: 500, to: 1500 }]))
      .toEqual([]);
  });

  it("returns empty when ranges are identical", () => {
    expect(diffVisibleRanges([{ from: 0, to: 1000 }], [{ from: 0, to: 1000 }]))
      .toEqual([]);
  });

  it("returns the newly-visible tail on scroll down", () => {
    expect(diffVisibleRanges(
      [{ from: 0, to: 1000 }],
      [{ from: 500, to: 2000 }],
    )).toEqual([{ from: 1000, to: 2000 }]);
  });

  it("returns the newly-visible head on scroll up", () => {
    expect(diffVisibleRanges(
      [{ from: 500, to: 1500 }],
      [{ from: 0, to: 1000 }],
    )).toEqual([{ from: 0, to: 500 }]);
  });

  it("returns full new range when there is no overlap", () => {
    expect(diffVisibleRanges(
      [{ from: 0, to: 100 }],
      [{ from: 200, to: 300 }],
    )).toEqual([{ from: 200, to: 300 }]);
  });

  it("returns all new ranges when old is empty", () => {
    expect(diffVisibleRanges([], [{ from: 0, to: 100 }]))
      .toEqual([{ from: 0, to: 100 }]);
  });

  it("returns empty when both are empty", () => {
    expect(diffVisibleRanges([], [])).toEqual([]);
  });

  it("handles multiple old ranges with a gap filled by new", () => {
    expect(diffVisibleRanges(
      [{ from: 0, to: 50 }, { from: 100, to: 150 }],
      [{ from: 40, to: 60 }, { from: 90, to: 160 }],
    )).toEqual([
      { from: 50, to: 60 },
      { from: 90, to: 100 },
      { from: 150, to: 160 },
    ]);
  });

  it("handles viewport expanding in both directions", () => {
    expect(diffVisibleRanges(
      [{ from: 200, to: 800 }],
      [{ from: 100, to: 1000 }],
    )).toEqual([
      { from: 100, to: 200 },
      { from: 800, to: 1000 },
    ]);
  });
});

describe("createCursorSensitiveViewPlugin", () => {
  let view: EditorView | undefined;

  interface CursorSensitivePluginProbe {
    decorations: DecorationSet;
    coveredRanges: readonly { from: number; to: number }[];
    rebuild(view: EditorView): void;
    update(update: ViewUpdate): void;
    incrementalDocUpdate(
      update: ViewUpdate,
      dirtyRanges: readonly { from: number; to: number }[],
    ): void;
  }

  function getPluginProbe(ext: ReturnType<typeof createCursorSensitiveViewPlugin>): CursorSensitivePluginProbe {
    const plugin = view?.plugin(ext as unknown as ViewPlugin<CursorSensitivePluginProbe>);
    expect(plugin).toBeTruthy();
    if (!plugin) throw new Error("expected cursor-sensitive plugin instance");
    return plugin;
  }

  function setVisibleRanges(
    ranges: readonly { from: number; to: number }[],
  ): (next: readonly { from: number; to: number }[]) => void {
    let current = ranges;
    Object.defineProperty(view!, "visibleRanges", {
      configurable: true,
      get: () => current,
    });
    return (next) => { current = next; };
  }

  function mockViewportUpdate(): ViewUpdate {
    return {
      docChanged: false,
      selectionSet: false,
      focusChanged: false,
      viewportChanged: true,
      state: view!.state,
      startState: view!.state,
      view: view!,
    } as unknown as ViewUpdate;
  }

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("returns a valid Extension", () => {
    const ext = createCursorSensitiveViewPlugin(() => []);
    expect(ext).toBeDefined();
  });

  it("calls collectFn on construction with visibleRanges", () => {
    let receivedRanges: readonly { from: number; to: number }[] = [];
    const ext = createCursorSensitiveViewPlugin((_v, ranges) => {
      receivedRanges = ranges;
      return [];
    });
    view = createTestView("hello world", { extensions: [markdown(), ext] });
    expect(receivedRanges.length).toBeGreaterThan(0);
  });

  it("calls collectFn on doc change (full rebuild)", () => {
    let callCount = 0;
    const ext = createCursorSensitiveViewPlugin(() => {
      callCount++;
      return [];
    });
    view = createTestView("hello", { extensions: [markdown(), ext] });
    callCount = 0;
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(callCount).toBe(1);
  });

  it("rebuilds only dirty doc ranges when docChangeRanges opts in", () => {
    let receivedRanges: readonly { from: number; to: number }[] = [];
    const ext = createCursorSensitiveViewPlugin(
      (_v, ranges) => {
        receivedRanges = ranges;
        return [];
      },
      {
        selectionCheck: () => false,
        docChangeRanges: (update) => {
          const dirtyRanges: { from: number; to: number }[] = [];
          update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
            dirtyRanges.push({ from: fromB, to: toB });
          });
          return dirtyRanges;
        },
      },
    );
    view = createTestView("hello world", { extensions: [markdown(), ext] });
    view.dispatch({ selection: { anchor: 0 } });
    receivedRanges = [];
    view.dispatch({ changes: { from: 6, to: 11, insert: "friend" } });
    expect(receivedRanges).toEqual([{ from: 6, to: 12 }]);
  });

  it("rebuilds only local context ranges when contextChangeRanges opts in", () => {
    let receivedRanges: readonly { from: number; to: number }[] = [];
    const ext = createCursorSensitiveViewPlugin(
      (_v, ranges) => {
        receivedRanges = ranges;
        return [];
      },
      {
        contextChangeRanges: (update) =>
          update.selectionSet ? [{ from: 4, to: 7 }] : [],
      },
    );
    view = createTestView("hello world", { extensions: [markdown(), ext] });
    view.dispatch({ selection: { anchor: 0 } });
    receivedRanges = [];

    view.dispatch({ selection: { anchor: 5 } });

    expect(receivedRanges).toEqual([{ from: 4, to: 7 }]);
  });

  it("combines local context ranges with newly visible fragments", () => {
    let receivedRanges: readonly { from: number; to: number }[] = [];
    const ext = createCursorSensitiveViewPlugin(
      (_v, ranges) => {
        receivedRanges = ranges;
        return [];
      },
      {
        contextChangeRanges: () => [{ from: 60, to: 70 }],
      },
    );
    view = createTestView("x".repeat(300), { extensions: [markdown(), ext] });
    const plugin = getPluginProbe(ext);
    const setRanges = setVisibleRanges([{ from: 0, to: 100 }]);
    plugin.rebuild(view);
    receivedRanges = [];

    setRanges([{ from: 50, to: 150 }]);
    plugin.update({
      docChanged: false,
      selectionSet: true,
      focusChanged: false,
      viewportChanged: true,
      state: view.state,
      startState: view.state,
      view,
    } as unknown as ViewUpdate);

    expect(receivedRanges).toEqual([
      { from: 60, to: 70 },
      { from: 100, to: 150 },
    ]);
  });

  it("evicts offscreen decorations and avoids duplicates when scrolling back", () => {
    const trackedNodes = [
      { from: 10, to: 20 },
      { from: 80, to: 120 },
      { from: 150, to: 170 },
    ];
    const ext = createCursorSensitiveViewPlugin((_view, ranges, skip) => {
      const items = [];
      for (const node of trackedNodes) {
        if (!ranges.some((range) => node.from < range.to && node.to > range.from)) continue;
        if (skip(node.from)) continue;
        items.push(Decoration.mark({ class: `node-${node.from}` }).range(node.from, node.to));
      }
      return items;
    });
    view = createTestView("x".repeat(300), { extensions: [markdown(), ext] });
    const plugin = getPluginProbe(ext);
    const setRanges = setVisibleRanges([{ from: 0, to: 100 }]);
    plugin.rebuild(view);

    const specKeys = () => getDecorationSpecs(plugin.decorations)
      .map((spec) => `${spec.class}:${spec.from}-${spec.to}`)
      .sort();

    expect(specKeys()).toEqual([
      "node-10:10-20",
      "node-80:80-120",
    ]);
    expect(plugin.coveredRanges).toEqual([{ from: 0, to: 100 }]);

    setRanges([{ from: 90, to: 190 }]);
    plugin.update(mockViewportUpdate());
    expect(specKeys()).toEqual([
      "node-150:150-170",
      "node-80:80-120",
    ]);
    expect(plugin.coveredRanges).toEqual([{ from: 90, to: 190 }]);

    setRanges([{ from: 0, to: 100 }]);
    plugin.update(mockViewportUpdate());
    expect(specKeys()).toEqual([
      "node-10:10-20",
      "node-80:80-120",
    ]);
    expect(getDecorationSpecs(plugin.decorations).filter((spec) => spec.from === 80)).toHaveLength(1);
    expect(plugin.coveredRanges).toEqual([{ from: 0, to: 100 }]);
  });

  it("filters only the dirty visible fragment on incremental doc updates", () => {
    const ext = createCursorSensitiveViewPlugin(() => []);
    view = createTestView("x".repeat(300), { extensions: [markdown(), ext] });
    const plugin = getPluginProbe(ext);
    setVisibleRanges([{ from: 0, to: 120 }]);
    plugin.rebuild(view);

    const updateSpy = vi.spyOn(Object.getPrototypeOf(plugin.decorations), "update");
    const tr = view.state.update({ changes: { from: 25, insert: "!" } });

    try {
      plugin.incrementalDocUpdate({
        changes: tr.changes,
        docChanged: true,
        selectionSet: false,
        focusChanged: false,
        viewportChanged: false,
        state: tr.state,
        startState: view.state,
        view,
      } as unknown as ViewUpdate, [{ from: 25, to: 26 }]);

      const filterCalls = updateSpy.mock.calls
        .map(([spec]) => spec as { filterFrom?: number; filterTo?: number; filter?: unknown })
        .filter((spec) => spec.filter !== undefined);

      expect(filterCalls.some((spec) => spec.filterFrom === 25 && spec.filterTo === 26)).toBe(true);
      expect(
        filterCalls.some((spec) => spec.filterFrom === 0 && spec.filterTo === tr.state.doc.length),
      ).toBe(false);
    } finally {
      updateSpy.mockRestore();
    }
  });

  it("falls back to a full rebuild when docChangeRanges returns null", () => {
    let receivedRanges: readonly { from: number; to: number }[] = [];
    const ext = createCursorSensitiveViewPlugin(
      (_v, ranges) => {
        receivedRanges = ranges;
        return [];
      },
      {
        selectionCheck: () => false,
        docChangeRanges: () => null,
      },
    );
    view = createTestView("hello world", { extensions: [markdown(), ext] });
    view.dispatch({ selection: { anchor: 0 } });
    receivedRanges = [];
    view.dispatch({ changes: { from: 6, to: 11, insert: "friend" } });
    expect(receivedRanges).toEqual([{ from: 0, to: view.state.doc.length }]);
  });

  it("calls collectFn on selection change (full rebuild)", () => {
    let callCount = 0;
    const ext = createCursorSensitiveViewPlugin(() => {
      callCount++;
      return [];
    });
    view = createTestView("hello world", { extensions: [markdown(), ext] });
    callCount = 0;
    view.dispatch({ selection: { anchor: 5 } });
    expect(callCount).toBe(1);
  });

  it("triggers full rebuild when extraRebuildCheck fires", () => {
    let callCount = 0;
    const ext = createCursorSensitiveViewPlugin(
      () => { callCount++; return []; },
      { extraRebuildCheck: () => true },
    );
    view = createTestView("hello", { extensions: [markdown(), ext] });
    callCount = 0;
    // Dispatch a no-op transaction — extraRebuildCheck returns true
    view.dispatch({});
    expect(callCount).toBe(1);
  });

  it("passes skip=NO_SKIP on full rebuild", () => {
    let skipResult: boolean | undefined;
    const ext = createCursorSensitiveViewPlugin((_v, _r, skip) => {
      skipResult = skip(42);
      return [];
    });
    view = createTestView("hello", { extensions: [markdown(), ext] });
    // Full rebuild on construction — skip should always return false
    expect(skipResult).toBe(false);
  });
});
