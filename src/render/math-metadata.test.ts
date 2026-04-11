import { describe, expect, it } from "vitest";
import { type ViewUpdate } from "@codemirror/view";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { frontmatterField } from "../editor/frontmatter-state";
import { documentSemanticsField } from "../state/document-analysis";
import { activeStructureEditField } from "../editor/structure-edit-state";
import { createMockEditorView } from "../test-utils";
import { mathRenderPlugin, _mathDecorationFieldForTest as mathDecorationField } from "./math-render";
import { _docChangeAffectsVisibleMathWidgetsForTest as docChangeAffectsVisibleMathWidgets } from "./math-metadata";

function createMathState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({ extensions: [mathExtension, equationLabelExtension] }),
      frontmatterField,
      activeStructureEditField,
      documentSemanticsField,
      mathRenderPlugin,
    ],
  });
}

function createUpdate(
  startState: EditorState,
  spec: TransactionSpec,
): ViewUpdate {
  const tr = startState.update(spec);
  const view = createMockEditorView({
    state: {
      doc: tr.state.doc,
      selection: tr.state.selection,
      sliceDoc: tr.state.sliceDoc.bind(tr.state),
      field: tr.state.field.bind(tr.state),
    },
  });
  Object.assign(view, {
    viewport: { from: 0, to: tr.state.doc.length },
  });
  return {
    view,
    startState,
    state: tr.state,
    changes: tr.changes,
  } as unknown as ViewUpdate;
}

describe("docChangeAffectsVisibleMathWidgets", () => {
  it("skips resync when the edit happens after visible math widgets", () => {
    const state = createMathState("Before $x^2$ after");
    const update = createUpdate(state, {
      changes: { from: state.doc.length, insert: "!" },
    });

    expect(
      docChangeAffectsVisibleMathWidgets(update, mathDecorationField),
    ).toBe(false);
  });

  it("resyncs when the edit happens before a visible math widget", () => {
    const state = createMathState("Before $x^2$ after");
    const update = createUpdate(state, {
      changes: { from: 0, insert: "!" },
    });

    expect(
      docChangeAffectsVisibleMathWidgets(update, mathDecorationField),
    ).toBe(true);
  });
});
