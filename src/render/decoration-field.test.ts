import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import {
  StateEffect,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
} from "@codemirror/view";
import {
  createDecorationStateField,
  createDecorationsField,
  createLifecycleDecorationStateField,
  cursorSensitiveShouldRebuild,
  defaultShouldRebuild,
} from "./decoration-field";
import { editorFocusField, focusEffect } from "./focus-state";
import {
  createEditorState,
  createTestView,
  getDecorationSpecs,
} from "../test-utils";
import {
  clearFrontendPerf,
  getFrontendPerfSnapshot,
} from "../lib/perf";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";

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
      (tr) => tr.effects.some((effect) => effect.is(customEffect)),
    );
    const state = createEditorState("hello", { extensions: [markdown(), field] });
    callCount = 0;

    const afterDoc = state.update({ changes: { from: 0, insert: "x" } }).state;
    expect(callCount).toBe(0);
    expect(afterDoc.field(field)).toBe(Decoration.none);

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
      (state) => {
        buildCount++;
        if (state.doc.lines >= 2) {
          return Decoration.set([lineDeco.range(state.doc.line(2).from)]);
        }
        return Decoration.none;
      },
      () => false,
      true,
    );
    const state = createEditorState("first\nsecond", { extensions: [field] });
    expect(buildCount).toBe(1);

    const iter1 = state.field(field).iter();
    expect(iter1.from).toBe(6);

    buildCount = 0;
    const edited = state.update({ changes: { from: 0, insert: "XX" } }).state;

    expect(buildCount).toBe(0);
    const iter2 = edited.field(field).iter();
    expect(iter2.from).toBe(8);
  });

  it("rebuilds when predicate fires even with mapOnDocChanged enabled", () => {
    let buildCount = 0;
    const field = createDecorationsField(
      () => {
        buildCount++;
        return Decoration.none;
      },
      () => true,
      true,
    );
    const state = createEditorState("hello", { extensions: [field] });
    buildCount = 0;
    const edited = state.update({ changes: { from: 0, insert: "X" } }).state;
    edited.field(field);
    expect(buildCount).toBe(1);
  });

  it("mapped decorations survive deletion without corruption (#718)", () => {
    const lineDeco = Decoration.line({ class: "test-del" });
    const field = createDecorationsField(
      (state) => {
        const items: Range<Decoration>[] = [];
        for (let i = 1; i <= state.doc.lines; i++) {
          items.push(lineDeco.range(state.doc.line(i).from));
        }
        return Decoration.set(items);
      },
      () => false,
      true,
    );
    const state = createEditorState("aaa\nbbb\nccc", { extensions: [field] });
    const before = [...iterDecos(state.field(field))];
    expect(before.map((deco) => deco.from)).toEqual([0, 4, 8]);

    const edited = state.update({ changes: { from: 0, to: 4 } }).state;
    const after = [...iterDecos(edited.field(field))];
    expect(after.map((deco) => deco.from)).toEqual([0, 4]);
  });

  it("does not map when docChanged is false with mapOnDocChanged enabled", () => {
    let buildCount = 0;
    const field = createDecorationsField(
      () => {
        buildCount++;
        return Decoration.none;
      },
      () => false,
      true,
    );
    const state = createEditorState("hello", { extensions: [field] });
    buildCount = 0;
    const updated = state.update({ selection: { anchor: 3 } }).state;
    expect(buildCount).toBe(0);
    expect(updated.field(field)).toBe(state.field(field));
  });

  it("records create and update spans when a spanName is provided", () => {
    clearFrontendPerf();
    const field = createDecorationsField(
      () => Decoration.none,
      undefined,
      false,
      "cm6.testDecorations",
    );

    view = createTestView("hello", { extensions: [markdown(), field] });
    const afterCreate = getFrontendPerfSnapshot().recent.map((record) => record.name);
    expect(afterCreate).toContain("cm6.testDecorations.create");

    clearFrontendPerf();
    const updated = view.state.update({ changes: { from: 0, insert: "x" } }).state;
    expect(updated.field(field)).toBe(Decoration.none);

    expect(getFrontendPerfSnapshot().recent.map((record) => record.name)).toContain(
      "cm6.testDecorations.update",
    );
  });
});

describe("createDecorationStateField", () => {
  let view: EditorView | undefined;

  beforeEach(() => {
    clearFrontendPerf();
  });

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("delegates explicit create/update handlers", () => {
    const lineDeco = Decoration.line({ class: "test-state-field" });
    let createCount = 0;
    let updateCount = 0;
    const field = createDecorationStateField({
      create() {
        createCount++;
        return Decoration.set([lineDeco.range(0)]);
      },
      update() {
        updateCount++;
        return Decoration.set([lineDeco.range(0)]);
      },
    });

    view = createTestView("hello", { extensions: [markdown(), field] });
    expect(createCount).toBe(1);
    expect(getDecorationSpecs(view.state.field(field))[0].class).toBe("test-state-field");

    const updated = view.state.update({ changes: { from: 0, insert: "x" } }).state;
    expect(updateCount).toBe(1);
    expect(getDecorationSpecs(updated.field(field))[0].class).toBe("test-state-field");
  });

  it("records an update span when a spanName is provided", () => {
    const field = createDecorationStateField({
      spanName: "cm6.testDecorations",
      create() {
        return Decoration.none;
      },
      update() {
        return Decoration.none;
      },
    });

    view = createTestView("hello", { extensions: [markdown(), field] });
    clearFrontendPerf();
    const updated = view.state.update({ changes: { from: 0, insert: "x" } }).state;
    expect(updated.field(field)).toBe(Decoration.none);

    expect(getFrontendPerfSnapshot().recent.map((record) => record.name)).toContain(
      "cm6.testDecorations.update",
    );
  });
});

describe("createLifecycleDecorationStateField", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("maps stable document changes through the shared lifecycle contract", () => {
    const lineDeco = Decoration.line({ class: "test-lifecycle" });
    let buildCount = 0;
    const field = createLifecycleDecorationStateField({
      build(state) {
        buildCount++;
        return Decoration.set([lineDeco.range(state.doc.line(2).from)]);
      },
      collectRanges: () => [],
      semanticChanged: () => false,
    });
    const state = createEditorState("first\nsecond", { extensions: [field] });
    expect(buildCount).toBe(1);

    const edited = state.update({ changes: { from: 0, insert: "XX" } }).state;

    expect(buildCount).toBe(1);
    const cursor = edited.field(field).iter();
    expect(cursor.from).toBe(8);
  });

  it("rebuilds programmatic rewrites even when semantic checks report stable state", () => {
    let buildCount = 0;
    const field = createLifecycleDecorationStateField({
      build() {
        buildCount++;
        return Decoration.none;
      },
      collectRanges: () => [],
      semanticChanged: () => false,
    });
    const state = createEditorState("hello", { extensions: [field] });
    expect(buildCount).toBe(1);

    const edited = state.update({
      changes: { from: 0, to: 5, insert: "world" },
      annotations: programmaticDocumentChangeAnnotation.of(true),
    }).state;
    edited.field(field);

    expect(buildCount).toBe(2);
  });
});

describe("defaultShouldRebuild", () => {
  it("returns true on docChanged", () => {
    const field = editorFocusField;
    const state = createEditorState("hello", { extensions: [markdown(), field] });
    const tr = state.update({ changes: { from: 0, insert: "x" } });
    expect(defaultShouldRebuild(tr)).toBe(true);
  });

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
