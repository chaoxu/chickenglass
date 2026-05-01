import { expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { collectMathRanges, mathRenderPlugin } from "./math-render";
import { frontmatterField } from "../state/frontmatter-state";
import { mathMacrosField } from "../state/math-macros";
import { createTestView } from "../test-utils";
import { focusEffect } from "./render-utils";
import { documentSemanticsField } from "../state/document-analysis";
import {
  activeStructureEditField,
  createStructureEditTargetAt,
  setStructureEditTargetEffect,
} from "../state/cm-structure-edit";
import { CSS } from "../constants/css-classes";

/** Count only widget (replace) decorations, ignoring mark decorations like cf-math-source. */
export function countWidgets(ranges: ReturnType<typeof collectMathRanges>): number {
  return ranges.filter(r => r.value.spec.widget).length;
}

export function countSourceMarks(ranges: ReturnType<typeof collectMathRanges>): number {
  return ranges.filter((r) => r.value.spec.class === CSS.mathSource).length;
}

export function countMarksWithClass(
  ranges: ReturnType<typeof collectMathRanges>,
  className: string,
): number {
  return ranges.filter((r) => r.value.spec.class === className).length;
}

/** Create an EditorView with math parser extensions at the given cursor position. */
export function createMathView(doc: string, cursorPos?: number): EditorView {
  return createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: [mathExtension, equationLabelExtension] }),
      frontmatterField,
      activeStructureEditField,
      documentSemanticsField,
      mathMacrosField,
    ],
  });
}

/**
 * Create an EditorView with math + equation label extensions.
 *
 * focus: false mirrors the original createMathViewWithLabels behaviour which
 * did not call view.focus(). collectMathRanges() guards on view.hasFocus via
 * cursorInRange(), so an unfocused view always produces widget decorations
 * regardless of cursor position — which is what the equation-label tests need.
 */
export function createMathViewWithLabels(doc: string, cursorPos?: number): EditorView {
  return createTestView(doc, {
    cursorPos,
    focus: false,
    extensions: [
      markdown({ extensions: [mathExtension, equationLabelExtension] }),
      frontmatterField,
      activeStructureEditField,
      documentSemanticsField,
      mathMacrosField,
    ],
  });
}

export function createMathRenderState(doc: string, cursorPos = 0): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions: [
      markdown({ extensions: [mathExtension, equationLabelExtension] }),
      frontmatterField,
      activeStructureEditField,
      documentSemanticsField,
      mathRenderPlugin,
    ],
  });
}

export function createMathRenderView(doc: string, cursorPos = 0): EditorView {
  const view = createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: [mathExtension, equationLabelExtension] }),
      frontmatterField,
      activeStructureEditField,
      documentSemanticsField,
      mathRenderPlugin,
    ],
  });
  view.dispatch({ effects: focusEffect.of(true) });
  return view;
}

export function activateDisplayMathSourceView(view: EditorView, pos: number): void {
  const target = createStructureEditTargetAt(view.state, pos);
  expect(target?.kind).toBe("display-math");
  if (!target) throw new Error("expected display-math structure-edit target");
  view.dispatch({
    effects: setStructureEditTargetEffect.of(target),
    selection: { anchor: pos },
  });
}
