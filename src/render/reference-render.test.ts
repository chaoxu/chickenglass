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
import { CSS } from "../constants/css-classes";
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

  it("applies source mark to reference containing the cursor", () => {
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
    expect(ref).toBeDefined();
    // Should be a mark decoration (source styling), not a widget
    expect(ref!.value.spec.widget).toBeUndefined();
    expect(ref!.value.spec.class).toBe(CSS.referenceSource);
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

    // Cursor-in ref gets a source mark (not a widget)
    const thmRef = ranges.find((r) => r.from === thmStart);
    expect(thmRef).toBeDefined();
    expect(thmRef!.value.spec.class).toBe(CSS.referenceSource);
    // The other ref still gets a widget
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

  // Regression: clustered equation references ([@eq:a; @eq:b]) where all ids
  // are crossrefs (not citations) were silently dropped because the code only
  // handled hasCitation or single-id non-citation branches. (#335)
  it("routes clustered equation crossrefs to ClusteredCrossrefWidget", () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "$$b^2$$ {#eq:beta}",
      "",
      "See [@eq:alpha; @eq:beta].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@eq:alpha; @eq:beta]",
    );
    expect(ref).toBeDefined();
    if (!ref) return;
    expect(widgetClass(ref)).toBe("ClusteredCrossrefWidget");
  });

  // Regression (#397): clustered crossrefs must render per-item spans
  // with data-ref-id attributes, not a flat text join.
  it("renders clustered equation crossrefs with per-item spans", () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "$$b^2$$ {#eq:beta}",
      "",
      "See [@eq:alpha; @eq:beta].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@eq:alpha; @eq:beta]",
    );
    expect(ref).toBeDefined();
    if (!ref) return;
    const widget = ref.value.spec.widget;
    expect(widget).toBeDefined();
    if (!widget) return;
    const el = widget.toDOM() as HTMLElement;
    expect(el.textContent).toBe("Eq. (1); Eq. (2)");

    // Per-item spans with data-ref-id
    const spans = el.querySelectorAll("span[data-ref-id]");
    expect(spans.length).toBe(2);
    expect(spans[0].getAttribute("data-ref-id")).toBe("eq:alpha");
    expect(spans[1].getAttribute("data-ref-id")).toBe("eq:beta");
  });

  // Regression (#397): clustered block crossrefs must have per-item spans
  it("routes clustered block crossrefs to ClusteredCrossrefWidget with per-item spans", () => {
    const doc = [
      "::: {.theorem #thm-a}",
      "A.",
      ":::",
      "",
      "::: {.theorem #thm-b}",
      "B.",
      ":::",
      "",
      "See [@thm-a; @thm-b].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@thm-a; @thm-b]",
    );
    expect(ref).toBeDefined();
    if (!ref) return;
    expect(widgetClass(ref)).toBe("ClusteredCrossrefWidget");
    const widget = ref.value.spec.widget;
    expect(widget).toBeDefined();
    if (!widget) return;
    const el = widget.toDOM() as HTMLElement;
    expect(el.textContent).toBe("Theorem 1; Theorem 2");

    // Per-item spans with data-ref-id
    const spans = el.querySelectorAll("span[data-ref-id]");
    expect(spans.length).toBe(2);
    expect(spans[0].getAttribute("data-ref-id")).toBe("thm-a");
    expect(spans[1].getAttribute("data-ref-id")).toBe("thm-b");
  });

  it("routes clustered unknown crossrefs to UnresolvedRefWidget", () => {
    const doc = "See [@unknown-a; @unknown-b].";
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@unknown-a; @unknown-b]",
    );
    expect(ref).toBeDefined();
    if (!ref) return;
    expect(widgetClass(ref)).toBe("UnresolvedRefWidget");
  });

  // Regression (#358): mixed crossref+citation clusters like [@eq:foo; @smith2020]
  // must NOT send all ids to CSL. Instead, crossref ids are resolved as labels
  // and citation ids are formatted via CslProcessor.cite().
  it("routes mixed crossref+citation cluster to MixedClusterWidget", () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "See [@eq:alpha; @karger2000].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@eq:alpha; @karger2000]",
    );
    expect(ref).toBeDefined();
    if (!ref) return;
    expect(widgetClass(ref)).toBe("MixedClusterWidget");
  });

  // Regression (#397): mixed cluster must have per-item spans with data-ref-id
  it("renders mixed cluster with per-item spans and data-ref-id", () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "See [@eq:alpha; @karger2000].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@eq:alpha; @karger2000]",
    );
    expect(ref).toBeDefined();
    if (!ref) return;
    const widget = ref.value.spec.widget;
    expect(widget).toBeDefined();
    if (!widget) return;
    const el = widget.toDOM() as HTMLElement;
    // Should contain the crossref label for eq:alpha and a citation for karger2000
    expect(el.textContent).toContain("Eq. (1)");
    // The combined text should be wrapped in parens with semicolon separator
    expect(el.textContent).toMatch(/^\(Eq\. \(1\); .+\)$/);
    expect(el.className).toBe(CSS.citation);

    // Per-item spans with data-ref-id
    const spans = el.querySelectorAll("span[data-ref-id]");
    expect(spans.length).toBe(2);
    expect(spans[0].getAttribute("data-ref-id")).toBe("eq:alpha");
    expect(spans[1].getAttribute("data-ref-id")).toBe("karger2000");
  });

  it("renders mixed block-crossref+citation cluster correctly", () => {
    const doc = [
      "::: {.theorem #thm-main}",
      "Statement.",
      ":::",
      "",
      "See [@thm-main; @karger2000].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@thm-main; @karger2000]",
    );
    expect(ref).toBeDefined();
    if (!ref) return;
    expect(widgetClass(ref)).toBe("MixedClusterWidget");
    const widget = ref.value.spec.widget;
    expect(widget).toBeDefined();
    if (!widget) return;
    const el = widget.toDOM() as HTMLElement;
    expect(el.textContent).toContain("Theorem 1");
  });

  it("pure citation cluster still routes to CitationWidget (not MixedClusterWidget)", () => {
    const doc = "See [@karger2000; @stein2001].";
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@karger2000; @stein2001]",
    );
    expect(ref).toBeDefined();
    if (!ref) return;
    // Should be CitationWidget, not MixedClusterWidget
    expect(widgetClass(ref)).toBe("CitationWidget");
  });

  it("pure crossref cluster still routes to ClusteredCrossrefWidget", () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "$$b^2$$ {#eq:beta}",
      "",
      "See [@eq:alpha; @eq:beta].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@eq:alpha; @eq:beta]",
    );
    expect(ref).toBeDefined();
    if (!ref) return;
    // Should be ClusteredCrossrefWidget, not MixedClusterWidget
    expect(widgetClass(ref)).toBe("ClusteredCrossrefWidget");
  });

  describe("negative / edge-case", () => {
    it("returns empty array for plain text with no @ characters", () => {
      view = createView("No references here. Just text.", 0);
      expect(collectReferenceRanges(view, store)).toHaveLength(0);
    });

    it("returns empty array for empty store and unknown id", () => {
      const emptyStore = makeBibStore([]);
      view = createView("See [@totally-unknown].", 0);
      const ranges = collectReferenceRanges(view, emptyStore);
      // Unknown id with empty store → UnresolvedRefWidget
      const ref = ranges.find(
        (r) => view.state.sliceDoc(r.from, r.to) === "[@totally-unknown]",
      );
      expect(ref).toBeDefined();
      expect(widgetClass(ref!)).toBe("UnresolvedRefWidget");
    });

    it("applies source mark when cursor is at its exact start position", () => {
      const doc = "See [@karger2000].";
      const refStart = doc.indexOf("[@karger2000]");
      view = createView(doc, refStart);
      const ranges = collectReferenceRanges(view, store);
      // Cursor exactly at start is inside the reference — gets source mark
      const ref = ranges.find((r) => r.from === refStart);
      expect(ref).toBeDefined();
      expect(ref!.value.spec.class).toBe(CSS.referenceSource);
    });

    it("handles document with only blank lines", () => {
      view = createView("\n\n\n", 0);
      expect(collectReferenceRanges(view, store)).toHaveLength(0);
    });
  });
});
