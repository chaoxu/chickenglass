import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { frontmatterDecoration, frontmatterDecorationField } from "./frontmatter-render";
import { frontmatterField } from "../state/frontmatter-state";
import {
  activeStructureEditField,
  createStructureEditTargetAt,
  setStructureEditTargetEffect,
} from "../state/cm-structure-edit";
import { applyStateEffects } from "../test-utils";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [frontmatterField, activeStructureEditField, frontmatterDecoration],
  });
}

function getTitleWidget(state: EditorState): { eq(other: unknown): boolean } {
  const iter = state.field(frontmatterDecorationField).iter();
  const widget = iter.value?.spec.widget as { eq(other: unknown): boolean } | undefined;
  expect(widget).toBeDefined();
  if (!widget) {
    throw new Error("expected frontmatter title widget");
  }
  return widget;
}

describe("frontmatterDecoration", () => {
  it("creates decoration hiding frontmatter", () => {
    const doc = "---\ntitle: Hello\n---\nContent";
    const state = createState(doc);
    const decos = state.field(frontmatterDecorationField);
    // Should have exactly one decoration range
    const iter = decos.iter();
    expect(iter.value).not.toBeNull();
    expect(iter.from).toBe(0);
    expect(iter.to).toBe(state.field(frontmatterField).end);
  });

  it("creates no decorations when no frontmatter", () => {
    const state = createState("# No frontmatter");
    const decos = state.field(frontmatterDecorationField);
    const iter = decos.iter();
    expect(iter.value).toBeNull();
  });

  it("refreshes the title widget when math macros change but title text stays the same", () => {
    const originalDoc = [
      "---",
      "title: $\\R$",
      "math:",
      "  \\R: \\mathbb{R}",
      "---",
      "Content",
    ].join("\n");
    const state = createState(originalDoc);
    const oldWidget = getTitleWidget(state);

    const nextDoc = originalDoc.replace("\\mathbb{R}", "\\mathbf{R}");
    const tr = state.update({
      changes: { from: 0, to: originalDoc.length, insert: nextDoc },
    });
    const newWidget = getTitleWidget(tr.state);

    expect(oldWidget.eq(newWidget)).toBe(false);
  });

  it("maps the title widget through edits after frontmatter instead of rebuilding it", () => {
    const doc = "---\ntitle: Hello\n---\nContent";
    const state = createState(doc);
    const oldWidget = getTitleWidget(state);

    const tr = state.update({
      changes: { from: doc.length, insert: " more" },
    });
    const newWidget = getTitleWidget(tr.state);

    expect(newWidget).toBe(oldWidget);
  });

  it("keeps the title shell when the cursor enters frontmatter until structure edit activates", () => {
    const doc = "---\ntitle: Hello\n---\nContent";
    const state = EditorState.create({
      doc,
      selection: { anchor: 5 },
      extensions: [frontmatterField, activeStructureEditField, frontmatterDecoration],
    });
    const iter = state.field(frontmatterDecorationField).iter();

    expect(iter.value?.spec.widget?.constructor?.name).toBe("TitleWidget");
  });

  it("reveals raw YAML only when frontmatter structure edit is active", () => {
    const doc = "---\ntitle: Hello\n---\nContent";
    const state = createState(doc);
    const target = createStructureEditTargetAt(state, 0);
    expect(target).not.toBeNull();

    const active = applyStateEffects(
      state,
      setStructureEditTargetEffect.of(target),
    );
    const iter = active.field(frontmatterDecorationField).iter();

    expect(iter.value).not.toBeNull();
    expect(iter.value?.spec.widget).toBeUndefined();
    expect(iter.from).toBe(0);
    expect(iter.to).toBe(0);
  });
});
