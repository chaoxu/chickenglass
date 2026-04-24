import { describe, expect, it, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { fencedDiv } from "../parser/fenced-div";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { frontmatterField } from "../editor/frontmatter-state";
import { createPluginRegistryField } from "../state/plugin-registry";
import { blockCounterField } from "../state/block-counter";
import { documentSemanticsField } from "../state/document-analysis";
import { documentReferenceCatalogField } from "../semantics/editor-reference-catalog";
import { bibDataEffect, bibDataField } from "../state/bib-data";
import { CslProcessor } from "../citations/csl-processor";
import {
  applyStateEffects,
  createEditorState,
  CSL_FIXTURES,
  makeBibStore,
  makeBlockPlugin,
} from "../test-utils";
import type { DocumentReferenceCatalog } from "../semantics/reference-catalog";
import {
  createCatalogReferencePresentationController,
  getReferencePresentationComputationCountForTest,
  getReferencePresentationModel,
  planReferencePresentation,
  referencePresentationField,
  resetReferencePresentationComputationCountForTest,
  type ReferencePresentationInput,
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
      referencePresentationField,
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

  it("reuses the model across non-document updates and invalidates on doc edits", () => {
    const state = withBibliography(createState("See [@karger2000]."));

    const first = getReferencePresentationModel(state);
    expect(first.getPreviewText("karger2000")).toContain("Minimum cuts in near-linear time");
    expect(first.getDisplayText("karger2000")).toBe("Karger 2000");
    expect(getReferencePresentationComputationCountForTest()).toBe(1);

    const selectionState = state.update({
      selection: { anchor: 0 },
    }).state;
    const second = getReferencePresentationModel(selectionState);
    expect(second).toBe(first);
    expect(second.getPreviewText("karger2000")).toContain("Minimum cuts in near-linear time");
    expect(getReferencePresentationComputationCountForTest()).toBe(1);

    const nextState = state.update({
      changes: {
        from: state.doc.length,
        insert: "\n\nMore text.",
      },
    }).state;
    const third = getReferencePresentationModel(nextState);
    expect(third).not.toBe(first);
    expect(third.getPreviewText("karger2000"))
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

const catalogTargets = [
  {
    id: "thm-main",
    kind: "block" as const,
    from: 0,
    to: 10,
    displayLabel: "Theorem 1",
    ordinal: 1,
    title: "Main",
  },
  {
    id: "eq-main",
    kind: "equation" as const,
    from: 20,
    to: 30,
    displayLabel: "Eq. (1)",
    ordinal: 1,
  },
] as const;

const catalog: DocumentReferenceCatalog = {
  targets: catalogTargets,
  targetsById: new Map(catalogTargets.map((target) => [target.id, [target]])),
  uniqueTargetById: new Map(catalogTargets.map((target) => [target.id, target])),
  duplicatesById: new Map(),
  references: [],
};

function makeInput(
  ids: readonly string[],
  raw: string,
  bracketed = true,
): ReferencePresentationInput {
  return {
    bracketed,
    ids,
    locators: ids.map(() => undefined),
    raw,
  };
}

describe("reference presentation controller", () => {
  it("uses one classification policy for local targets and citations", () => {
    const controller = createCatalogReferencePresentationController(catalog, {
      bibliography: makeBibStore([CSL_FIXTURES.karger]),
      cite: (ids) => `[${ids.join(", ")}]`,
      citeNarrative: (id) => `${id} narrative`,
    });

    expect(controller.classify("thm-main", true)).toMatchObject({
      kind: "crossref",
      resolved: { kind: "block", label: "Theorem 1" },
    });
    expect(controller.classify("karger2000", true)).toEqual({
      kind: "citation",
      id: "karger2000",
    });
    expect(controller.classify("missing", true)).toEqual({
      kind: "unresolved",
      id: "missing",
    });
  });

  it("routes mixed and clustered references from the shared presentation plan", () => {
    const controller = createCatalogReferencePresentationController(catalog, {
      bibliography: makeBibStore([CSL_FIXTURES.karger]),
      cite: (ids) => `(${ids.join("; ")})`,
      citeNarrative: (id) => `${id} narrative`,
    });

    expect(controller.planReference(
      makeInput(["eq-main", "karger2000"], "[@eq-main; @karger2000]"),
    )).toMatchObject({
      kind: "mixed-cluster",
      parts: [
        { kind: "crossref", id: "eq-main", text: "Eq. (1)" },
        { kind: "citation", id: "karger2000", text: "karger2000" },
      ],
    });

    expect(planReferencePresentation(
      controller,
      makeInput(["thm-main", "missing"], "[@thm-main; @missing]"),
    )).toMatchObject({
      kind: "clustered-crossref",
      parts: [
        { id: "thm-main", text: "Theorem 1" },
        { id: "missing", text: "missing", unresolved: true },
      ],
    });
  });
});
