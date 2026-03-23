import { describe, expect, it, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { fencedDiv } from "../parser/fenced-div";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { frontmatterField } from "../editor/frontmatter-state";
import { createPluginRegistryField } from "../plugins/plugin-registry";
import { blockCounterField } from "../plugins/block-counter";
import { documentSemanticsField } from "../semantics/codemirror-source";
import type { BlockPlugin } from "../plugins/plugin-types";
import type { CslJsonItem } from "../citations/bibtex-parser";
import { bibDataEffect, bibDataField } from "../citations/citation-render";
import { CslProcessor } from "../citations/csl-processor";
import { createTestView, makeBlockPlugin, makeBibStore } from "../test-utils";
import { collectReferenceRanges } from "./reference-render";

const testPlugins: readonly BlockPlugin[] = [
  makeBlockPlugin({ name: "theorem", counter: "theorem", title: "Theorem" }),
  makeBlockPlugin({ name: "lemma", counter: "theorem", title: "Lemma" }),
  makeBlockPlugin({ name: "definition", title: "Definition" }),
];

const karger: CslJsonItem = {
  id: "karger2000",
  type: "article-journal",
  author: [{ family: "Karger", given: "David R." }],
  title: "Minimum cuts in near-linear time",
  issued: { "date-parts": [[2000]] },
  "container-title": "JACM",
};

const stein: CslJsonItem = {
  id: "stein2001",
  type: "book",
  author: [{ family: "Stein", given: "Clifford" }],
  title: "Algorithms",
  issued: { "date-parts": [[2001]] },
};

const store = makeBibStore([karger, stein]);

function createView(doc: string, cursorPos?: number): EditorView {
  const view = createTestView(doc, {
    cursorPos,
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
  view.dispatch({ effects: bibDataEffect.of({ store, cslProcessor: new CslProcessor([karger, stein]) }) });
  return view;
}

function widgetClass(range: { value: { spec: { widget?: { constructor: { name: string } } } } }): string | undefined {
  return range.value.spec.widget?.constructor.name;
}

describe("collectReferenceRanges", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("routes bracketed block reference to CrossrefWidget", () => {
    const doc = [
      "::: {.theorem #thm-main}",
      "Statement.",
      ":::",
      "",
      "See [@thm-main].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@thm-main]",
    );
    expect(ref).toBeDefined();
    expect(widgetClass(ref!)).toBe("CrossrefWidget");
  });

  it("routes bracketed equation reference to CrossrefWidget", () => {
    const doc = [
      "$$E = mc^2$$ {#eq:energy}",
      "",
      "See [@eq:energy].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@eq:energy]",
    );
    expect(ref).toBeDefined();
    expect(widgetClass(ref!)).toBe("CrossrefWidget");
  });

  it("routes bracketed citation to CitationWidget", () => {
    const doc = "See [@karger2000] for details.";
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@karger2000]",
    );
    expect(ref).toBeDefined();
    expect(widgetClass(ref!)).toBe("CitationWidget");
  });

  it("routes unknown bracketed id to UnresolvedRefWidget", () => {
    const doc = "See [@unknown-thing].";
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@unknown-thing]",
    );
    expect(ref).toBeDefined();
    expect(widgetClass(ref!)).toBe("UnresolvedRefWidget");
  });

  it("skips reference containing the cursor", () => {
    const doc = [
      "::: {.theorem #thm-1}",
      "T1.",
      ":::",
      "",
      "See [@thm-1].",
    ].join("\n");
    const refStart = doc.indexOf("[@thm-1]");
    view = createView(doc, refStart + 3);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find((r) => r.from === refStart);
    expect(ref).toBeUndefined();
  });

  it("collects other references when cursor is inside one", () => {
    const doc = [
      "::: {.theorem #thm-1}",
      "T1.",
      ":::",
      "",
      "::: {.definition #def-1}",
      "D1.",
      ":::",
      "",
      "See [@thm-1] and [@def-1].",
    ].join("\n");
    const thmStart = doc.indexOf("[@thm-1]");
    const defStart = doc.indexOf("[@def-1]");

    view = createView(doc, thmStart + 2);
    const ranges = collectReferenceRanges(view, store);

    expect(ranges.find((r) => r.from === thmStart)).toBeUndefined();
    expect(ranges.find((r) => r.from === defStart)).toBeDefined();
  });

  it("routes narrative @id to CrossrefWidget for blocks", () => {
    const doc = [
      "::: {.theorem #thm-main}",
      "Statement.",
      ":::",
      "",
      "As @thm-main shows.",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "@thm-main",
    );
    expect(ref).toBeDefined();
    expect(widgetClass(ref!)).toBe("CrossrefWidget");
  });

  it("routes narrative @id to CitationWidget for bib entries", () => {
    const doc = "As @karger2000 showed.";
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "@karger2000",
    );
    expect(ref).toBeDefined();
    expect(widgetClass(ref!)).toBe("CitationWidget");
  });

  it("returns empty array for document with no references", () => {
    view = createView("Just plain text.", 0);
    const ranges = collectReferenceRanges(view, store);
    expect(ranges).toHaveLength(0);
  });

  it("returns empty array for empty document", () => {
    view = createView("", 0);
    const ranges = collectReferenceRanges(view, store);
    expect(ranges).toHaveLength(0);
  });

  it("routes multi-citation bracket to CitationWidget", () => {
    const doc = "See [@karger2000; @stein2001].";
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@karger2000; @stein2001]",
    );
    expect(ref).toBeDefined();
    expect(widgetClass(ref!)).toBe("CitationWidget");
  });
});
