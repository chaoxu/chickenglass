import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { fencedDiv } from "../parser/fenced-div";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { frontmatterField } from "../editor/frontmatter-state";
import { createPluginRegistryField } from "../plugins/plugin-registry";
import { blockCounterField } from "../plugins/block-counter";
import { documentSemanticsField } from "../semantics/codemirror-source";
import type { BlockPlugin } from "../plugins/plugin-types";
import { createEditorState, makeBlockPlugin } from "../test-utils";
import {
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
    ],
  });
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

    expect(result.kind).toBe("block");
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

    expect(result.kind).toBe("block");
    expect(result.label).toBe("Appendix");
    expect(result.title).toBe("Appendix");
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
