import { afterEach, describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";

import { fencedDiv } from "../parser/fenced-div";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { frontmatterField } from "../editor/frontmatter-state";
import { documentSemanticsField } from "./document-analysis";
import { blockCounterField } from "./block-counter";
import { createPluginRegistryField } from "./plugin-registry";
import type { BlockPlugin } from "../plugins/plugin-types";
import { bibDataEffect, bibDataField } from "../citations/citation-render";
import { CslProcessor } from "../citations/csl-processor";
import {
  createCslFixture,
  createTestView,
  makeBibStore,
  makeBlockPlugin,
} from "../test-utils";
import {
  getTableReferenceRenderDependencySignature,
  tableReferenceRenderDependenciesChanged,
} from "./reference-render-state";

const testPlugins: readonly BlockPlugin[] = [
  makeBlockPlugin({ name: "theorem", counter: "theorem", title: "Theorem" }),
];

const karger = createCslFixture({
  id: "karger2000",
  author: [{ family: "Karger", given: "David R." }],
  title: "Minimum cuts in near-linear time",
  issued: { "date-parts": [[2000]] },
});

const stein = createCslFixture({
  id: "stein2001",
  type: "book",
  author: [{ family: "Stein", given: "Clifford" }],
  title: "Algorithms",
  issued: { "date-parts": [[2001]] },
});

const store = makeBibStore([karger, stein]);

function createReferenceStateView(doc: string): EditorView {
  const view = createTestView(doc, {
    cursorPos: 0,
    extensions: [
      markdown({
        extensions: [fencedDiv, mathExtension, equationLabelExtension],
      }),
      frontmatterField,
      documentSemanticsField,
      createPluginRegistryField(testPlugins),
      blockCounterField,
      bibDataField,
    ],
  });

  view.dispatch({
    effects: bibDataEffect.of({
      store,
      cslProcessor: new CslProcessor([karger, stein]),
    }),
  });

  return view;
}

describe("table reference render dependencies", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("ignores plain prose edits that only shift later references", () => {
    const doc = [
      "::: {.theorem #thm-main}",
      "Statement.",
      ":::",
      "",
      "| kind | target |",
      "| --- | --- |",
      "| theorem | [@thm-main] |",
      "",
      "Plain prose line.",
      "",
      "See [@thm-main].",
    ].join("\n");

    view = createReferenceStateView(doc);
    const beforeState = view.state;
    const beforeSignature = getTableReferenceRenderDependencySignature(beforeState);
    const insertAt = doc.indexOf("Plain") + "Plain".length;

    view.dispatch({
      changes: {
        from: insertAt,
        insert: " updated",
      },
    });

    const afterState = view.state;
    expect(tableReferenceRenderDependenciesChanged(beforeState, afterState)).toBe(false);
    expect(getTableReferenceRenderDependencySignature(afterState)).toBe(beforeSignature);
  });

  it("tracks citation-order changes that can renumber table citations", () => {
    const doc = [
      "| cite |",
      "| --- |",
      "| [@stein2001] |",
      "",
      "Tail paragraph.",
    ].join("\n");

    view = createReferenceStateView(doc);
    const beforeState = view.state;
    const beforeSignature = getTableReferenceRenderDependencySignature(beforeState);

    view.dispatch({
      changes: {
        from: 0,
        insert: "See [@karger2000].\n\n",
      },
    });

    const afterState = view.state;
    expect(tableReferenceRenderDependenciesChanged(beforeState, afterState)).toBe(true);
    expect(getTableReferenceRenderDependencySignature(afterState)).not.toBe(beforeSignature);
  });
});
