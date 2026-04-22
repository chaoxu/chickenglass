import { describe, expect, it } from "vitest";
import type { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { fencedDiv } from "../parser/fenced-div";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { frontmatterField } from "../editor/frontmatter-state";
import { blockCounterField } from "../state/block-counter";
import { createPluginRegistryField } from "../state/plugin-registry";
import { documentSemanticsField } from "../state/document-analysis";
import { bibDataEffect, bibDataField } from "../state/bib-data";
import { CslProcessor } from "../citations/csl-processor";
import type { BlockPlugin } from "../plugins/plugin-types";
import {
  CSL_FIXTURES,
  applyStateEffects,
  createEditorState,
  makeBibStore,
  makeBlockPlugin,
} from "../test-utils";
import { extractDiagnostics } from "./diagnostics";

const testPlugins: readonly BlockPlugin[] = [
  makeBlockPlugin({ name: "theorem", counter: "theorem", title: "Theorem" }),
  makeBlockPlugin({ name: "lemma", counter: "theorem", title: "Lemma" }),
  makeBlockPlugin({ name: "definition", title: "Definition" }),
];

function createState(doc: string): EditorState {
  return createEditorState(doc, {
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
}

function withBibliography(state: EditorState): EditorState {
  return applyStateEffects(state, bibDataEffect.of({
    store: makeBibStore([CSL_FIXTURES.karger]),
    cslProcessor: new CslProcessor([CSL_FIXTURES.karger]),
  }));
}

describe("extractDiagnostics", () => {
  it("warns on unresolved references without flagging known citations", () => {
    const state = withBibliography(createState(
      "See [@thm:missing] and [@karger2000].",
    ));

    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "warning",
        message: "Unresolved reference \"@thm:missing\"",
      }),
    ]);
  });

  it("reports cross-namespace local target collisions", () => {
    const state = createState([
      "# Intro {#dup}",
      "",
      "::: {.theorem #dup}",
      "Statement.",
      ":::",
    ].join("\n"));

    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "error",
        message: "Duplicate local target ID \"dup\"",
      }),
    ]);
  });
});
