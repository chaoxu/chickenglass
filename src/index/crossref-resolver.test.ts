import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { fencedDiv } from "../parser/fenced-div";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { frontmatterField } from "../state/frontmatter-state";
import { blockCounterField } from "../state/block-counter";
import { createPluginRegistryField } from "../state/plugin-registry";
import { documentSemanticsField } from "../state/document-analysis";
import { documentReferenceCatalogField } from "../semantics/editor-reference-catalog";
import * as referenceCatalogModule from "../semantics/reference-catalog";
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
import {
  classifyReference,
  collectEquationLabels,
  resolveCrossref,
  findCrossrefs,
} from "./crossref-resolver";

const testPlugins: readonly BlockPlugin[] = [
  makeBlockPlugin({ name: "theorem", counter: "theorem", title: "Theorem" }),
  makeBlockPlugin({ name: "lemma", counter: "theorem", title: "Lemma" }),
  makeBlockPlugin({ name: "definition", title: "Definition" }),
  makeBlockPlugin({ name: "proof", numbered: false, title: "Proof" }),
];

/** Create an EditorState with all necessary extensions for testing. */
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
      documentReferenceCatalogField,
      bibDataField,
    ],
  });
}

/** Create a minimal state with only math extensions (no block plugins). */
function createMathState(doc: string): EditorState {
  return createEditorState(doc, {
    extensions: [
      markdown({
        extensions: [mathExtension, equationLabelExtension],
      }),
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

describe("collectEquationLabels", () => {
  it("collects a single equation label", () => {
    const state = createMathState("$$x^2$$ {#eq:quadratic}");
    const labels = collectEquationLabels(state);
    expect(labels.size).toBe(1);
    expect(labels.get("eq:quadratic")).toEqual({
      id: "eq:quadratic",
      number: 1,
    });
  });

  it("assigns sequential numbers to multiple equation labels", () => {
    const doc = [
      "$$a$$ {#eq:first}",
      "",
      "$$b$$ {#eq:second}",
      "",
      "$$c$$ {#eq:third}",
    ].join("\n");
    const state = createMathState(doc);
    const labels = collectEquationLabels(state);

    expect(labels.size).toBe(3);
    expect(labels.get("eq:first")?.number).toBe(1);
    expect(labels.get("eq:second")?.number).toBe(2);
    expect(labels.get("eq:third")?.number).toBe(3);
  });

  it("returns empty map for document with no equation labels", () => {
    const state = createMathState("$$x^2$$\n\nNo labels here.");
    const labels = collectEquationLabels(state);
    expect(labels.size).toBe(0);
  });

  it("handles backslash bracket syntax", () => {
    const state = createMathState("\\[x^2\\] {#eq:bs}");
    const labels = collectEquationLabels(state);
    expect(labels.size).toBe(1);
    expect(labels.get("eq:bs")?.number).toBe(1);
  });
});

describe("resolveCrossref", () => {
  it("resolves a block reference to its label", () => {
    const doc = [
      "::: {.theorem #thm-main}",
      "Main theorem.",
      ":::",
      "",
      "See [@thm-main].",
    ].join("\n");
    const state = createState(doc);
    const result = resolveCrossref(state, "thm-main");

    expect(result.kind).toBe("block");
    expect(result.label).toBe("Theorem 1");
    expect(result.number).toBe(1);
  });

  it("resolves a lemma sharing counter with theorem", () => {
    const doc = [
      "::: {.theorem #thm-first}",
      "A theorem.",
      ":::",
      "",
      "::: {.lemma #lem-second}",
      "A lemma.",
      ":::",
    ].join("\n");
    const state = createState(doc);

    const thmResult = resolveCrossref(state, "thm-first");
    expect(thmResult.kind).toBe("block");
    expect(thmResult.label).toBe("Theorem 1");

    const lemResult = resolveCrossref(state, "lem-second");
    expect(lemResult.kind).toBe("block");
    expect(lemResult.label).toBe("Lemma 2");
  });

  it("resolves a definition with its own counter", () => {
    const doc = [
      "::: {.theorem #thm-1}",
      "T1.",
      ":::",
      "",
      "::: {.definition #def-1}",
      "D1.",
      ":::",
    ].join("\n");
    const state = createState(doc);

    const defResult = resolveCrossref(state, "def-1");
    expect(defResult.kind).toBe("block");
    expect(defResult.label).toBe("Definition 1");
    expect(defResult.number).toBe(1);
  });

  it("resolves an equation reference", () => {
    const doc = "$$E = mc^2$$ {#eq:einstein}";
    const state = createState(doc);
    const result = resolveCrossref(state, "eq:einstein");

    expect(result.kind).toBe("equation");
    expect(result.label).toBe("Eq. (1)");
    expect(result.number).toBe(1);
  });

  it("resolves multiple equation references with correct numbering", () => {
    const doc = [
      "$$a$$ {#eq:first}",
      "",
      "$$b$$ {#eq:second}",
    ].join("\n");
    const state = createState(doc);

    const first = resolveCrossref(state, "eq:first");
    expect(first.kind).toBe("equation");
    expect(first.label).toBe("Eq. (1)");

    const second = resolveCrossref(state, "eq:second");
    expect(second.kind).toBe("equation");
    expect(second.label).toBe("Eq. (2)");
  });

  it("resolves a numbered heading reference as a section label", () => {
    const doc = [
      "# Intro",
      "",
      "## Min-Cost Circulation {#sec:mincostcirc}",
      "",
      "See [@sec:mincostcirc].",
    ].join("\n");
    const state = createState(doc);
    const result = resolveCrossref(state, "sec:mincostcirc");

    expect(result.kind).toBe("heading");
    expect(result.label).toBe("Section 1.1");
    expect(result.title).toBe("Min-Cost Circulation");
  });

  it("falls back to heading text for unnumbered heading references", () => {
    const doc = [
      "# Intro",
      "",
      "## Appendix {#sec:appendix .unnumbered}",
      "",
      "See [@sec:appendix].",
    ].join("\n");
    const state = createState(doc);
    const result = resolveCrossref(state, "sec:appendix");

    expect(result.kind).toBe("heading");
    expect(result.label).toBe("Appendix");
    expect(result.title).toBe("Appendix");
  });

  it("keeps fenced block references distinct from heading references", () => {
    const doc = [
      "# Intro",
      "",
      "## Result Section {#sec:result}",
      "",
      "::: {.theorem #thm-result}",
      "A theorem.",
      ":::",
    ].join("\n");
    const state = createState(doc);

    expect(resolveCrossref(state, "sec:result")).toMatchObject({
      kind: "heading",
      label: "Section 1.1",
      title: "Result Section",
    });
    expect(resolveCrossref(state, "thm-result")).toMatchObject({
      kind: "block",
      label: "Theorem 1",
    });
  });

  it("returns citation for unknown id", () => {
    const doc = "Some text.";
    const state = createState(doc);
    const result = resolveCrossref(state, "karger2000");

    expect(result.kind).toBe("citation");
    expect(result.label).toBe("karger2000");
  });

  it("prefers block label over citation for matching ids", () => {
    const doc = [
      "::: {.theorem #karger2000}",
      "A theorem with a citation-like id.",
      ":::",
    ].join("\n");
    const state = createState(doc);
    const result = resolveCrossref(state, "karger2000");

    expect(result.kind).toBe("block");
    expect(result.label).toBe("Theorem 1");
  });

  it("uses precomputed equation labels when provided", () => {
    const doc = "$$x$$ {#eq:test}";
    const state = createState(doc);
    const eqLabels = collectEquationLabels(state);
    const result = resolveCrossref(state, "eq:test", eqLabels);

    expect(result.kind).toBe("equation");
    expect(result.label).toBe("Eq. (1)");
  });

  // Resolution order is documented above resolveCrossref. The kinds in real
  // documents are namespaced by id prefix (thm:, eq:, sec:, fig:), so genuine
  // cross-kind collisions only happen when a user reuses a non-prefixed id.
  // The tests below pin the precedence so a future refactor cannot quietly
  // reorder it.
  it("prefers block label over heading when both share an id", () => {
    const doc = [
      "# Intro {#shared}",
      "",
      "::: {.theorem #shared}",
      "A theorem.",
      ":::",
    ].join("\n");
    const state = createState(doc);
    const result = resolveCrossref(state, "shared");

    expect(result.kind).toBe("block");
    expect(result.label).toBe("Theorem 1");
  });

  it("prefers equation label over heading when both share an id", () => {
    const doc = [
      "# Intro {#shared}",
      "",
      "$$x$$ {#shared}",
    ].join("\n");
    const state = createState(doc);
    const eqLabels = new Map([["shared", { id: "shared", number: 1 }]]);
    const result = resolveCrossref(state, "shared", eqLabels);

    expect(result.kind).toBe("equation");
    expect(result.label).toBe("Eq. (1)");
  });
});

describe("classifyReference", () => {
  it("prefers local crossrefs for bracketed refs when a citation shares the same id", () => {
    const doc = [
      "::: {.theorem #karger2000}",
      "A theorem with a citation-like id.",
      ":::",
      "",
      "See [@karger2000].",
    ].join("\n");
    const state = withBibliography(createState(doc));

    const result = classifyReference(state, "karger2000", {
      bibliography: state.field(bibDataField).store,
      preferCitation: true,
    });

    expect(result.kind).toBe("crossref");
    if (result.kind !== "crossref") {
      throw new Error("expected a crossref result");
    }
    expect(result.resolved.label).toBe("Theorem 1");
  });

  it("prefers local crossrefs for narrative refs when a citation shares the same id", () => {
    const doc = [
      "::: {.theorem #karger2000}",
      "A theorem with a citation-like id.",
      ":::",
      "",
      "See @karger2000.",
    ].join("\n");
    const state = withBibliography(createState(doc));

    const result = classifyReference(state, "karger2000", {
      bibliography: state.field(bibDataField).store,
    });

    expect(result.kind).toBe("crossref");
    if (result.kind !== "crossref") {
      throw new Error("expected a crossref result");
    }
    expect(result.resolved.label).toBe("Theorem 1");
  });

  it("returns unresolved when an id matches neither bibliography nor local targets", () => {
    const state = createState("See [@thm:missing].");

    const result = classifyReference(state, "thm:missing", {
      bibliography: state.field(bibDataField).store,
      preferCitation: true,
    });

    expect(result).toEqual({
      kind: "unresolved",
      id: "thm:missing",
    });
  });

  it("classifies heading references as crossrefs with heading kind", () => {
    const state = createState([
      "# Intro",
      "",
      "## Methods {#sec:methods}",
      "",
      "See [@sec:methods].",
    ].join("\n"));

    const result = classifyReference(state, "sec:methods");

    expect(result.kind).toBe("crossref");
    if (result.kind !== "crossref") {
      throw new Error("expected a crossref result");
    }
    expect(result.resolved.kind).toBe("heading");
    expect(result.resolved.label).toBe("Section 1.1");
  });

  it("reuses the cached document reference catalog across repeated classifications", () => {
    const doc = [
      "::: {.theorem #thm-main}",
      "Main theorem.",
      ":::",
      "",
      "See [@thm-main].",
    ].join("\n");
    const state = createState(doc);
    const spy = vi.spyOn(referenceCatalogModule, "buildDocumentReferenceCatalog");

    // Initial state-field creation may have already built the catalog once.
    spy.mockClear();

    for (let i = 0; i < 5; i += 1) {
      const result = classifyReference(state, "thm-main");
      expect(result.kind).toBe("crossref");
    }

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("findCrossrefs", () => {
  it("finds bracketed reference [@id]", () => {
    const state = createState("See [@thm-main] for details.");
    const refs = findCrossrefs(state);

    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe("thm-main");
    expect(refs[0].bracketed).toBe(true);
    expect(refs[0].from).toBe(4);
    expect(refs[0].to).toBe(15);
  });

  it("finds narrative reference @id", () => {
    const state = createState("As shown in @thm-main, we have...");
    const refs = findCrossrefs(state);

    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe("thm-main");
    expect(refs[0].bracketed).toBe(false);
  });

  it("finds multiple references", () => {
    const state = createState("See [@thm-1] and [@eq:foo] and @def-2.");
    const refs = findCrossrefs(state);

    expect(refs).toHaveLength(3);
    expect(refs[0].id).toBe("thm-1");
    expect(refs[0].bracketed).toBe(true);
    expect(refs[1].id).toBe("eq:foo");
    expect(refs[1].bracketed).toBe(true);
    expect(refs[2].id).toBe("def-2");
    expect(refs[2].bracketed).toBe(false);
  });

  it("handles ids with colons and dashes", () => {
    const state = createState("[@eq:my-equation.v2]");
    const refs = findCrossrefs(state);

    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe("eq:my-equation.v2");
  });

  it("returns empty array for document with no references", () => {
    const state = createState("Plain text without any references.");
    const refs = findCrossrefs(state);

    expect(refs).toHaveLength(0);
  });

  it("does not match @ inside words", () => {
    const state = createState("email@example.com is not a reference");
    const refs = findCrossrefs(state);

    expect(refs).toHaveLength(0);
  });

  it("handles empty document", () => {
    const state = createState("");
    const refs = findCrossrefs(state);

    expect(refs).toHaveLength(0);
  });

  it("finds reference at start of line", () => {
    const state = createState("@thm-main is important.");
    const refs = findCrossrefs(state);

    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe("thm-main");
    expect(refs[0].from).toBe(0);
  });
});
