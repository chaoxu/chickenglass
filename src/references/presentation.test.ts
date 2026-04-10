import { describe, expect, it, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { fencedDiv } from "../parser/fenced-div";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { frontmatterField } from "../editor/frontmatter-state";
import { documentSemanticsField } from "../semantics/codemirror-source";
import { createPluginRegistryField } from "../state/plugin-registry";
import { blockCounterField } from "../state/block-counter";
import { documentReferenceCatalogField } from "../semantics/editor-reference-catalog";
import { bibDataEffect, bibDataField } from "../citations/citation-render";
import { CslProcessor } from "../citations/csl-processor";
import {
  applyStateEffects,
  createEditorState,
  CSL_FIXTURES,
  makeBibStore,
  makeBlockPlugin,
} from "../test-utils";
import {
  getReferencePresentationComputationCountForTest,
  getReferencePresentationModel,
  resetReferencePresentationComputationCountForTest,
} from "./presentation";

function createState(doc: string): EditorState {
  return createEditorState(doc, {
    extensions: [
      markdown({
        extensions: [fencedDiv, mathExtension, equationLabelExtension],
      }),
      frontmatterField,
      documentSemanticsField,
      createPluginRegistryField([
        makeBlockPlugin({ name: "theorem", counter: "theorem", title: "Theorem" }),
      ]),
      blockCounterField,
      documentReferenceCatalogField,
      bibDataField,
    ],
  });
}

function withBibliography(
  state: EditorState,
  items = [CSL_FIXTURES.karger],
): EditorState {
  return applyStateEffects(state, bibDataEffect.of({
    store: makeBibStore(items),
    cslProcessor: new CslProcessor(items),
  }));
}

afterEach(() => {
  resetReferencePresentationComputationCountForTest();
});

describe("getReferencePresentationModel", () => {
  it("reads local display text from the shared catalog and citation text from the bibliography", () => {
    const state = withBibliography(createState([
      "# Background {#sec:background}",
      "",
      "::: {.theorem #thm:main}",
      "Statement.",
      ":::",
      "",
      "$$x^2$$ {#eq:main}",
    ].join("\n")));

    const presentation = getReferencePresentationModel(state);

    expect(presentation.getDisplayText("sec:background")).toBe("Section 1");
    expect(presentation.getDisplayText("thm:main")).toBe("Theorem 1");
    expect(presentation.getDisplayText("eq:main")).toBe("Eq. (1)");
    expect(presentation.getDisplayText("karger2000")).toBe("Karger 2000");
    expect(presentation.getPreviewText("thm:main")).toBeUndefined();
    expect(presentation.getPreviewText("karger2000")).toBe(
      "Karger, David R.. Minimum cuts in near-linear time. JACM, 47(1), 46-76. 2000.",
    );
  });

  it("formats each citation once per document version", () => {
    const state = withBibliography(createState("See [@karger2000]."));

    const first = getReferencePresentationModel(state);
    expect(first.getPreviewText("karger2000")).toContain("Minimum cuts in near-linear time");
    expect(first.getDisplayText("karger2000")).toBe("Karger 2000");
    expect(getReferencePresentationComputationCountForTest()).toBe(1);

    const second = getReferencePresentationModel(state);
    expect(second.getPreviewText("karger2000")).toContain("Minimum cuts in near-linear time");
    expect(getReferencePresentationComputationCountForTest()).toBe(1);

    const nextState = state.update({
      changes: {
        from: state.doc.length,
        insert: "\n\nMore text.",
      },
    }).state;
    expect(getReferencePresentationModel(nextState).getPreviewText("karger2000"))
      .toContain("Minimum cuts in near-linear time");
    expect(getReferencePresentationComputationCountForTest()).toBe(2);
  });

  it("invalidates citation formatting when the bibliography store changes without a doc edit", () => {
    const state = withBibliography(createState("See [@karger2000]."));
    const firstPreview = getReferencePresentationModel(state).getPreviewText("karger2000");
    expect(firstPreview).toContain("Minimum cuts in near-linear time");
    expect(getReferencePresentationComputationCountForTest()).toBe(1);

    const updatedEntry = {
      ...CSL_FIXTURES.karger,
      title: "Updated title",
    };
    const nextState = withBibliography(state, [updatedEntry]);
    expect(getReferencePresentationModel(nextState).getPreviewText("karger2000"))
      .toContain("Updated title");
    expect(getReferencePresentationComputationCountForTest()).toBe(2);
  });
});
