import { markdown } from "@codemirror/lang-markdown";
import type { ChangeSpec, EditorState } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { expect } from "vitest";
import type { CslJsonItem } from "../citations/bibtex-parser";
import { bibDataEffect, bibDataField } from "../state/bib-data";
import { CslProcessor } from "../citations/csl-processor";
import { frontmatterField } from "../state/frontmatter-state";
import {
  activeStructureEditField,
} from "../state/cm-structure-edit";
import { equationLabelExtension } from "../parser/equation-label";
import { fencedDiv } from "../parser/fenced-div";
import { mathExtension } from "../parser/math-backslash";
import type { BlockPlugin } from "../plugins/plugin-types";
import { blockCounterField } from "../state/block-counter";
import { documentSemanticsField } from "../state/document-analysis";
import {
  createPluginRegistryField,
} from "../state/plugin-registry";
import { createTestView, makeBibStore, makeBlockPlugin } from "../test-utils";
import { focusEffect } from "./focus-state";
import { referenceRenderPlugin } from "./reference-render";

export const testPlugins: readonly BlockPlugin[] = [
  makeBlockPlugin({ name: "theorem", counter: "theorem", title: "Theorem" }),
  makeBlockPlugin({ name: "lemma", counter: "theorem", title: "Lemma" }),
  makeBlockPlugin({ name: "definition", title: "Definition" }),
];

export const karger: CslJsonItem = {
  id: "karger2000",
  type: "article-journal",
  author: [{ family: "Karger", given: "David R." }],
  title: "Minimum cuts in near-linear time",
  issued: { "date-parts": [[2000]] },
  "container-title": "JACM",
};

export const stein: CslJsonItem = {
  id: "stein2001",
  type: "book",
  author: [{ family: "Stein", given: "Clifford" }],
  title: "Algorithms",
  issued: { "date-parts": [[2001]] },
};

export const store = makeBibStore([karger, stein]);

export function createView(doc: string, cursorPos?: number, focus = true): EditorView {
  const view = createTestView(doc, {
    cursorPos,
    focus,
    extensions: [
      markdown({
        extensions: [fencedDiv, mathExtension, equationLabelExtension],
      }),
      frontmatterField,
      activeStructureEditField,
      documentSemanticsField,
      createPluginRegistryField(testPlugins),
      blockCounterField,
      bibDataField,
    ],
  });
  view.dispatch({ effects: bibDataEffect.of({ store, cslProcessor: new CslProcessor([karger, stein]) }) });
  if (focus) {
    view.dispatch({ effects: focusEffect.of(true) });
  }
  return view;
}

export function createPluginView(doc: string, cursorPos?: number, focus = true): EditorView {
  const view = createTestView(doc, {
    cursorPos,
    focus,
    extensions: [
      markdown({
        extensions: [fencedDiv, mathExtension, equationLabelExtension],
      }),
      frontmatterField,
      activeStructureEditField,
      documentSemanticsField,
      createPluginRegistryField(testPlugins),
      blockCounterField,
      bibDataField,
      referenceRenderPlugin,
    ],
  });
  view.dispatch({ effects: bibDataEffect.of({ store, cslProcessor: new CslProcessor([karger, stein]) }) });
  if (focus) {
    view.dispatch({ effects: focusEffect.of(true) });
  }
  return view;
}

export function widgetClass(range: { value: { spec: { widget?: { constructor: { name: string } } } } }): string | undefined {
  return range.value.spec.widget?.constructor.name;
}

export function expectPresent<T>(value: T | null | undefined, label: string): asserts value is T {
  expect(value).toBeDefined();
  if (value == null) {
    throw new Error(`Expected ${label} to be defined`);
  }
}

export function revealReferenceAt(view: EditorView, pos: number): void {
  view.dispatch({ selection: { anchor: pos } });
}

export function mockReferenceViewUpdate(
  startState: EditorState,
  nextState: EditorState,
  changes: ChangeSpec,
): ViewUpdate {
  const tr = startState.update({ changes });
  expect(tr.state.doc.toString()).toBe(nextState.doc.toString());
  return {
    startState,
    state: nextState,
    view: {
      hasFocus: true,
    },
    docChanged: true,
    changes: tr.changes,
    focusChanged: false,
    selectionSet: false,
  } as unknown as ViewUpdate;
}
