import { markdown } from "@codemirror/lang-markdown";
import type { ChangeSpec, EditorState } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CslJsonItem } from "../citations/bibtex-parser";
import { bibDataEffect, bibDataField } from "../state/bib-data";
import { CslProcessor } from "../citations/csl-processor";
import { CSS } from "../constants/css-classes";
import { frontmatterField } from "../editor/frontmatter-state";
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
  pluginRegistryField,
} from "../state/plugin-registry";
import { createTestView, makeBibStore, makeBlockPlugin } from "../test-utils";
import {
  collectReferenceRanges,
  _computeReferenceDirtyRangesForTest as computeReferenceDirtyRanges,
  planReferenceRendering,
  type ReferenceRenderItem,
  referenceRenderDependenciesChanged,
  referenceRenderPlugin,
} from "./reference-render";
import { renderPreviewBlockContentToDom } from "./preview-block-renderer";

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

function createView(doc: string, cursorPos?: number, focus = true): EditorView {
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
  return view;
}

function createPluginView(doc: string, cursorPos?: number, focus = true): EditorView {
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
  return view;
}

function widgetClass(range: { value: { spec: { widget?: { constructor: { name: string } } } } }): string | undefined {
  return range.value.spec.widget?.constructor.name;
}

function expectPresent<T>(value: T | null | undefined, label: string): asserts value is T {
  expect(value).toBeDefined();
  if (value == null) {
    throw new Error(`Expected ${label} to be defined`);
  }
}

function revealReferenceAt(view: EditorView, pos: number): void {
  view.dispatch({ selection: { anchor: pos } });
}

function mockReferenceViewUpdate(
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
    const refStart = doc.indexOf("[@thm-main]");
    view = createView(doc, 0);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find((r) => r.from === refStart);
    expectPresent(ref, "reference range");
    expect(widgetClass(ref)).toBe("CrossrefWidget");
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
    expectPresent(ref, "reference range");
    expect(widgetClass(ref)).toBe("CrossrefWidget");
  });

  it("routes bracketed citation to CitationWidget", () => {
    const doc = "See [@karger2000] for details.";
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@karger2000]",
    );
    expectPresent(ref, "reference range");
    expect(widgetClass(ref)).toBe("CitationWidget");
  });

  it("reveals reference source when the focused cursor touches it", () => {
    const doc = "See [@karger2000] for details.";
    const refStart = doc.indexOf("[@karger2000]");
    view = createView(doc, refStart + 3);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find((r) => r.from === refStart);
    expectPresent(ref, "reference range");
    expect(ref?.value.spec.widget).toBeUndefined();
    expect(ref?.value.spec.class).toBe(CSS.referenceSource);
  });

  it("reveals reference source when the focused selection touches it", () => {
    const doc = "See [@karger2000] for details.";
    const refStart = doc.indexOf("[@karger2000]");
    view = createView(doc, 0);
    view.dispatch({
      selection: {
        anchor: refStart + 2,
        head: refStart + 8,
      },
    });
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find((r) => r.from === refStart);
    expectPresent(ref, "reference range");
    expect(ref?.value.spec.widget).toBeUndefined();
    expect(ref?.value.spec.class).toBe(CSS.referenceSource);
  });

  it("keeps rendered references when unfocused even if the cursor is inside", () => {
    const doc = "See [@karger2000] for details.";
    const refStart = doc.indexOf("[@karger2000]");
    view = createView(doc, refStart + 3, false);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find((r) => r.from === refStart);
    expectPresent(ref, "reference range");
    expect(widgetClass(ref)).toBe("CitationWidget");
  });

  it("routes unknown bracketed id to UnresolvedRefWidget", () => {
    const doc = "See [@unknown-thing].";
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@unknown-thing]",
    );
    expectPresent(ref, "reference range");
    expect(widgetClass(ref)).toBe("UnresolvedRefWidget");
  });

  it("applies source mark when the focused cursor enters a reference", () => {
    const doc = [
      "::: {.theorem #thm-1}",
      "T1.",
      ":::",
      "",
      "See [@thm-1].",
    ].join("\n");
    const refStart = doc.indexOf("[@thm-1]");
    view = createView(doc, doc.length);
    revealReferenceAt(view, refStart + 3);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find((r) => r.from === refStart);
    expectPresent(ref, "reference range");
    // Should be a mark decoration (source styling), not a widget
    expect(ref?.value.spec.widget).toBeUndefined();
    expect(ref?.value.spec.class).toBe(CSS.referenceSource);
  });

  it("collects other references when one reference is revealed by the focused cursor", () => {
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

    view = createView(doc, doc.length);
    revealReferenceAt(view, thmStart + 2);
    const ranges = collectReferenceRanges(view, store);

    // The revealed ref gets a source mark (not a widget)
    const thmRef = ranges.find((r) => r.from === thmStart);
    expect(thmRef).toBeDefined();
    expect(thmRef?.value.spec.class).toBe(CSS.referenceSource);
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
    expectPresent(ref, "reference range");
    expect(widgetClass(ref)).toBe("CrossrefWidget");
  });

  it("routes narrative @id to CitationWidget for bib entries", () => {
    const doc = "As @karger2000 showed.";
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "@karger2000",
    );
    expectPresent(ref, "reference range");
    expect(widgetClass(ref)).toBe("CitationWidget");
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
    expectPresent(ref, "reference range");
    expect(widgetClass(ref)).toBe("CitationWidget");
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
    expectPresent(ref, "reference range");
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
    expectPresent(ref, "reference range");
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
    expectPresent(ref, "reference range");
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
    expectPresent(ref, "reference range");
    if (!ref) return;
    expect(widgetClass(ref)).toBe("UnresolvedRefWidget");
  });

  it("keeps partially resolved crossref clusters rendered in place", () => {
    const doc = [
      "::: {.theorem #thm-a}",
      "A.",
      ":::",
      "",
      "See [@thm-a; @missing].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@thm-a; @missing]",
    );
    expectPresent(ref, "reference range");
    if (!ref) return;
    expect(widgetClass(ref)).toBe("ClusteredCrossrefWidget");
    const widget = ref.value.spec.widget;
    expect(widget).toBeDefined();
    if (!widget) return;
    const el = widget.toDOM() as HTMLElement;
    const spans = el.querySelectorAll("span[data-ref-id]");
    expect(spans.length).toBe(2);
    expect(spans[0].textContent).toBe("Theorem 1");
    expect(spans[1].textContent).toBe("missing");
    expect(spans[1].className).toBe(CSS.crossrefUnresolved);
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
    expectPresent(ref, "reference range");
    if (!ref) return;
    expect(widgetClass(ref)).toBe("MixedClusterWidget");
  });

  it("keeps shared processors stable after preview rendering (#788)", async () => {
    const doc = "See [@karger2000] and [@stein2001].";
    const processor = await CslProcessor.create([karger, stein]);
    view = createView(doc, doc.length);
    view.dispatch({ effects: bibDataEffect.of({ store, cslProcessor: processor }) });

    collectReferenceRanges(view, store);

    const preview = document.createElement("div");
    renderPreviewBlockContentToDom(preview, "Preview [@karger2000].", {
      bibliography: store,
      cslProcessor: processor,
    });

    const ranges = collectReferenceRanges(view, store);
    const steinRange = ranges.find(
      (range) => view.state.sliceDoc(range.from, range.to) === "[@stein2001]",
    );
    expect(steinRange).toBeDefined();
    if (!steinRange) return;

    const widget = steinRange.value.spec.widget;
    expect(widget).toBeDefined();
    if (!widget) return;

    expect((widget.toDOM() as HTMLElement).textContent).toBe("[2]");
  });

  // Regression (#397): mixed cluster must have per-item spans with data-ref-id
  it("renders mixed cluster with per-item spans and data-ref-id", async () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "See [@eq:alpha; @karger2000].",
    ].join("\n");
    // Needs an initialized CSL engine so cite() returns formatted text
    const processor = await CslProcessor.create([karger, stein]);
    view = createView(doc, doc.length);
    view.dispatch({ effects: bibDataEffect.of({ store, cslProcessor: processor }) });
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@eq:alpha; @karger2000]",
    );
    expectPresent(ref, "reference range");
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
    expectPresent(ref, "reference range");
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
    expectPresent(ref, "reference range");
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
    expectPresent(ref, "reference range");
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
      expectPresent(ref, "reference range");
    expect(widgetClass(ref)).toBe("UnresolvedRefWidget");
    });

    it("applies source mark when focused cursor reveal starts at the token boundary", () => {
      const doc = "See [@karger2000].";
      const refStart = doc.indexOf("[@karger2000]");
      view = createView(doc, doc.length);
      revealReferenceAt(view, refStart);
      const ranges = collectReferenceRanges(view, store);
      const ref = ranges.find((r) => r.from === refStart);
      expectPresent(ref, "reference range");
      expect(ref?.value.spec.class).toBe(CSS.referenceSource);
    });

    it("handles document with only blank lines", () => {
      view = createView("\n\n\n", 0);
      expect(collectReferenceRanges(view, store)).toHaveLength(0);
    });
  });

  describe("performance invalidation", () => {
    it("ignores unrelated semantic edits after all references", () => {
      const doc = [
        "::: {.theorem #thm-main}",
        "Statement.",
        ":::",
        "",
        "See [@thm-main] and [@karger2000].",
        "",
        "# Tail heading",
      ].join("\n");

      view = createPluginView(doc, 0);
      const beforeState = view.state;

      view.dispatch({
        changes: {
          from: doc.indexOf("Tail"),
          to: doc.indexOf("Tail") + "Tail".length,
          insert: "Late",
        },
      });

      expect(referenceRenderDependenciesChanged(beforeState, view.state)).toBe(false);
    });

    it("tracks equation renumbering even when references stay in place", () => {
      const doc = [
        "See [@eq:beta].",
        "",
        "$$a^2$$ {#eq:alpha}",
        "",
        "$$b^2$$ {#eq:beta}",
      ].join("\n");

      view = createPluginView(doc, 0);
      const beforeState = view.state;
      const insert = "$$c^2$$ {#eq:middle}\n\n";
      const beforeSecondEquation = doc.indexOf("$$b^2$$");

      view.dispatch({
        changes: {
          from: beforeSecondEquation,
          insert,
        },
      });

      expect(referenceRenderDependenciesChanged(beforeState, view.state)).toBe(true);
    });

    it("tracks block renumbering even when references stay in place", () => {
      const doc = [
        "See [@thm-b].",
        "",
        "::: {.theorem #thm-a}",
        "A.",
        ":::",
        "",
        "::: {.theorem #thm-b}",
        "B.",
        ":::",
      ].join("\n");

      view = createPluginView(doc, 0);
      const beforeState = view.state;
      const insert = [
        "::: {.theorem #thm-middle}",
        "Middle.",
        ":::",
        "",
      ].join("\n");
      const beforeSecondBlock = doc.indexOf("::: {.theorem #thm-b}");

      view.dispatch({
        changes: {
          from: beforeSecondBlock,
          insert,
        },
      });

      expect(referenceRenderDependenciesChanged(beforeState, view.state)).toBe(true);
    });

    it("tracks block label changes from same-length frontmatter title edits", () => {
      const doc = [
        "---",
        "blocks:",
        "  theorem:",
        "    title: Result",
        "---",
        "",
        "::: {.theorem #thm-main}",
        "Statement.",
        ":::",
        "",
        "See [@thm-main].",
      ].join("\n");

      view = createPluginView(doc, 0);
      expect(view.dom.querySelector(`.${CSS.crossref}`)?.textContent).toBe("Result 1");

      const beforeState = view.state;
      const labelStart = doc.indexOf("Result");

      view.dispatch({
        changes: {
          from: labelStart,
          to: labelStart + "Result".length,
          insert: "Remark",
        },
      });

      expect(referenceRenderDependenciesChanged(beforeState, view.state)).toBe(true);
      expect(view.dom.querySelector(`.${CSS.crossref}`)?.textContent).toBe("Remark 1");
    });

    it("rerenders existing block refs when the numbering scheme flips", () => {
      const originalDoc = [
        "---",
        "title: AB",
        "numbering: global",
        "---",
        "",
        "::: {.theorem #thm-a}",
        "A.",
        ":::",
        "",
        "::: {.definition #def-b}",
        "B.",
        ":::",
        "",
        "See [@def-b].",
      ].join("\n");
      const nextDoc = originalDoc
        .replace("title: AB", "title: A")
        .replace("numbering: global", "numbering: grouped");

      view = createPluginView(originalDoc, 0);
      expect(view.dom.querySelector(`.${CSS.crossref}`)?.textContent).toBe("Definition 2");

      const beforeState = view.state;

      view.dispatch({
        changes: {
          from: 0,
          to: originalDoc.length,
          insert: nextDoc,
        },
      });

      expect(referenceRenderDependenciesChanged(beforeState, view.state)).toBe(true);
      expect(view.dom.querySelector(`.${CSS.crossref}`)?.textContent).toBe("Definition 1");
    });

    it("treats pure block-numbering changes as render dependencies", () => {
      const originalDoc = [
        "---",
        "title: AB",
        "numbering: global",
        "---",
        "",
        "::: {.theorem #thm-a}",
        "A.",
        ":::",
        "",
        "::: {.definition #def-b}",
        "B.",
        ":::",
        "",
        "See [@def-b].",
      ].join("\n");
      const nextDoc = originalDoc
        .replace("title: AB", "title: A")
        .replace("numbering: global", "numbering: grouped");

      const beforeView = createPluginView(originalDoc, 0);
      const afterView = createPluginView(nextDoc, 0);
      const beforeAnalysis = beforeView.state.field(documentSemanticsField);
      const afterAnalysis = afterView.state.field(documentSemanticsField);

      (
        afterAnalysis as {
          references: typeof beforeAnalysis.references;
          referenceByFrom: typeof beforeAnalysis.referenceByFrom;
        }
      ).references = beforeAnalysis.references;
      (
        afterAnalysis as {
          references: typeof beforeAnalysis.references;
          referenceByFrom: typeof beforeAnalysis.referenceByFrom;
        }
      ).referenceByFrom = beforeAnalysis.referenceByFrom;

      const makeState = (
        analysis: typeof beforeAnalysis,
        baseState: EditorState,
      ): EditorState => ({
        field(field: unknown) {
          if (field === documentSemanticsField) return analysis;
          if (field === blockCounterField) return baseState.field(blockCounterField);
          if (field === pluginRegistryField) return baseState.field(pluginRegistryField);
          if (field === bibDataField) return baseState.field(bibDataField);
          return undefined;
        },
      }) as unknown as EditorState;

      const beforeState = makeState(beforeAnalysis, beforeView.state);
      const afterState = makeState(afterAnalysis, afterView.state);

      expect(referenceRenderDependenciesChanged(beforeState, afterState)).toBe(true);

      beforeView.destroy();
      afterView.destroy();
    });

    it("ignores equation body edits that preserve crossref numbering", () => {
      const doc = [
        "See [@eq:alpha].",
        "",
        "$$a^2$$ {#eq:alpha}",
        "",
        "Tail paragraph.",
      ].join("\n");

      view = createPluginView(doc, 0);
      const beforeState = view.state;
      const equationBodyStart = doc.indexOf("a^2");

      view.dispatch({
        changes: {
          from: equationBodyStart,
          to: equationBodyStart + "a^2".length,
          insert: "a^3",
        },
      });

      expect(referenceRenderDependenciesChanged(beforeState, view.state)).toBe(false);
    });

    it("does not re-register citations on navigation outside references", () => {
      const registerSpy = vi.spyOn(CslProcessor.prototype, "registerCitations");
      const doc = [
        "Intro text before citations.",
        "",
        "See [@karger2000].",
        "",
        "More plain text after citations.",
      ].join("\n");

      view = createPluginView(doc, 0);
      registerSpy.mockClear();

      view.dispatch({ selection: { anchor: doc.indexOf("More plain text") } });

      expect(registerSpy).not.toHaveBeenCalled();
      registerSpy.mockRestore();
    });

    it("does not re-register citations after unrelated semantic edits", () => {
      const registerSpy = vi.spyOn(CslProcessor.prototype, "registerCitations");
      const doc = [
        "See [@karger2000].",
        "",
        "# Tail heading",
      ].join("\n");

      view = createPluginView(doc, 0);
      registerSpy.mockClear();

      view.dispatch({
        changes: {
          from: doc.indexOf("Tail"),
          to: doc.indexOf("Tail") + "Tail".length,
          insert: "Late",
        },
      });

      expect(registerSpy).not.toHaveBeenCalled();
      registerSpy.mockRestore();
    });

    it("skips dirty reference rescans for plain prose inserts on lines without refs", () => {
      const doc = [
        "Plain intro text.",
        "",
        "See [@karger2000].",
      ].join("\n");

      view = createPluginView(doc, 0);
      const insertAt = doc.indexOf("intro") + "intro".length;
      const nextState = view.state.update({
        changes: {
          from: insertAt,
          insert: " more",
        },
      }).state;

      const update = mockReferenceViewUpdate(
        view.state,
        nextState,
        {
          from: insertAt,
          insert: " more",
        },
      );

      expect(computeReferenceDirtyRanges(update)).toEqual([]);
    });

    it("keeps dirty reference rescans when the changed line contains a ref", () => {
      const doc = [
        "See [@karger2000].",
        "",
        "Tail text.",
      ].join("\n");

      view = createPluginView(doc, 0);
      const insertAt = doc.indexOf("karger2000");
      const nextState = view.state.update({
        changes: {
          from: insertAt,
          insert: "x",
        },
      }).state;

      const update = mockReferenceViewUpdate(
        view.state,
        nextState,
        {
          from: insertAt,
          insert: "x",
        },
      );

      expect(computeReferenceDirtyRanges(update).length).toBeGreaterThan(0);
    });

    it("re-registers citations when bibliography data changes", () => {
      const registerSpy = vi.spyOn(CslProcessor.prototype, "registerCitations");
      const doc = "See [@karger2000; @stein2001].";

      view = createPluginView(doc, 0);
      registerSpy.mockClear();

      view.dispatch({
        effects: bibDataEffect.of({
          store,
          cslProcessor: new CslProcessor([karger, stein]),
        }),
      });

      expect(registerSpy).toHaveBeenCalledTimes(1);
      registerSpy.mockRestore();
    });

    it("re-registers citations when the same processor is reused after setStyle()", async () => {
      const registerSpy = vi.spyOn(CslProcessor.prototype, "registerCitations");
      const doc = "See [@karger2000; @stein2001].";
      const processor = await CslProcessor.create([karger, stein]);

      view = createTestView(doc, {
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
          referenceRenderPlugin,
        ],
      });
      view.dispatch({ effects: bibDataEffect.of({ store, cslProcessor: processor }) });
      registerSpy.mockClear();

      await processor.setStyle("<style>invalid</style>");
      view.dispatch({ effects: bibDataEffect.of({ store, cslProcessor: processor }) });

      expect(registerSpy).toHaveBeenCalledTimes(1);
      registerSpy.mockRestore();
    });

    it("re-registers citations when document edits change citation order", () => {
      const registerSpy = vi.spyOn(CslProcessor.prototype, "registerCitations");
      const doc = "See [@karger2000] then [@stein2001].";

      view = createPluginView(doc, 0);
      registerSpy.mockClear();

      const first = "[@karger2000]";
      const second = "[@stein2001]";
      const firstStart = doc.indexOf(first);
      const secondStart = doc.indexOf(second);

      view.dispatch({
        changes: {
          from: firstStart,
          to: secondStart + second.length,
          insert: `${second} then ${first}`,
        },
      });

      expect(registerSpy).toHaveBeenCalledTimes(1);
      registerSpy.mockRestore();
    });
  });

  it("keeps citation routing when only the processor is cleared (#770)", () => {
    const doc = "See [@karger2000].";
    view = createView(doc, doc.length);

    // Initially the citation renders as a CitationWidget.
    const before = collectReferenceRanges(view, store);
    const citBefore = before.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@karger2000]",
    );
    expectPresent(citBefore, "citation range before clearing processor");
    expect(widgetClass(citBefore)).toBe("CitationWidget");

    // Simulate file-switch: keep the old store for routing, only replace
    // the processor with an empty one so the stale engine can't throw.
    view.dispatch({
      effects: bibDataEffect.of({
        store,
        cslProcessor: CslProcessor.empty(),
      }),
    });

    // Citations should still route as CitationWidget (store.has() works)
    // with blank rendered text (empty processor returns "").
    const after = collectReferenceRanges(view, store);
    const citAfter = after.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@karger2000]",
    );
    expectPresent(citAfter, "citation range after clearing processor");
    expect(widgetClass(citAfter)).toBe("CitationWidget");
  });
});

describe("planReferenceRendering", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  function plan(doc: string, cursorPos?: number): ReferenceRenderItem[] {
    view = createView(doc, cursorPos ?? doc.length);
    const { cslProcessor } = view.state.field(bibDataField);
    return planReferenceRendering(view, store, cslProcessor);
  }

  function findPlan(items: ReferenceRenderItem[], text: string): ReferenceRenderItem | undefined {
    return items.find((item) => view.state.sliceDoc(item.from, item.to) === text);
  }

  it("routes bracketed block reference to crossref plan", () => {
    const doc = [
      "::: {.theorem #thm-main}",
      "Statement.",
      ":::",
      "",
      "See [@thm-main].",
    ].join("\n");
    const items = plan(doc);
    const item = findPlan(items, "[@thm-main]");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("crossref");
  });

  it("routes bracketed local target before same-id citation", () => {
    const doc = [
      "::: {.theorem #karger2000}",
      "Statement.",
      ":::",
      "",
      "See [@karger2000].",
    ].join("\n");
    const items = plan(doc);
    const item = findPlan(items, "[@karger2000]");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("crossref");
    if (item?.kind === "crossref") {
      expect(item?.resolved.label).toBe("Theorem 1");
    }
  });

  it("routes bracketed citation to citation plan", () => {
    const items = plan("See [@karger2000] for details.");
    const item = findPlan(items, "[@karger2000]");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("citation");
    if (item?.kind === "citation") {
      expect(item?.narrative).toBe(false);
    }
  });

  it("routes narrative bib reference to narrative citation plan", () => {
    const items = plan("As @karger2000 showed.");
    const item = findPlan(items, "@karger2000");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("citation");
    if (item?.kind === "citation") {
      expect(item?.narrative).toBe(true);
    }
  });

  it("routes unknown bracketed id to unresolved plan", () => {
    const items = plan("See [@unknown-thing].");
    const item = findPlan(items, "[@unknown-thing]");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("unresolved");
  });

  it("routes focused cursor reveal to source-mark plan", () => {
    const doc = [
      "::: {.theorem #thm-1}",
      "T1.",
      ":::",
      "",
      "See [@thm-1].",
    ].join("\n");
    const refStart = doc.indexOf("[@thm-1]");
    const items = plan(doc, refStart + 3);
    const item = items.find((i) => i.from === refStart);
    expect(item).toBeDefined();
    expect(item?.kind).toBe("source-mark");
  });

  it("routes mixed crossref+citation to mixed-cluster plan", () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "See [@eq:alpha; @karger2000].",
    ].join("\n");
    const items = plan(doc);
    const item = findPlan(items, "[@eq:alpha; @karger2000]");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("mixed-cluster");
  });

  it("routes clustered equation crossrefs to clustered-crossref plan", () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "$$b^2$$ {#eq:beta}",
      "",
      "See [@eq:alpha; @eq:beta].",
    ].join("\n");
    const items = plan(doc);
    const item = findPlan(items, "[@eq:alpha; @eq:beta]");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("clustered-crossref");
  });

  it("keeps unresolved items inside clustered-crossref plans", () => {
    const doc = [
      "::: {.theorem #thm-a}",
      "A.",
      ":::",
      "",
      "See [@thm-a; @missing].",
    ].join("\n");
    const items = plan(doc);
    const item = findPlan(items, "[@thm-a; @missing]");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("clustered-crossref");
    if (!item || item.kind !== "clustered-crossref") return;
    expect(item.parts).toEqual([
      { id: "thm-a", text: "Theorem 1" },
      { id: "missing", text: "missing", unresolved: true },
    ]);
  });

  it("skips narrative refs that resolve to neither crossref nor citation", () => {
    const items = plan("As @unknown-thing goes.");
    expect(items).toHaveLength(0);
  });
});

describe("reference render plugin focus-driven reveal", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("reveals source when the cursor enters a reference and rerenders when it leaves", () => {
    const doc = "See [@karger2000] for details.";
    const refStart = doc.indexOf("[@karger2000]");
    view = createPluginView(doc, 0);

    expect(view.contentDOM.querySelector(`.${CSS.citation}`)).not.toBeNull();
    expect(view.contentDOM.querySelector(`.${CSS.referenceSource}`)).toBeNull();

    view.dispatch({ selection: { anchor: refStart + 3 } });

    expect(view.contentDOM.querySelector(`.${CSS.citation}`)).toBeNull();
    expect(view.contentDOM.querySelector(`.${CSS.referenceSource}`)).not.toBeNull();

    view.dispatch({ selection: { anchor: 0 } });

    expect(view.contentDOM.querySelector(`.${CSS.referenceSource}`)).toBeNull();
    expect(view.contentDOM.querySelector(`.${CSS.citation}`)).not.toBeNull();
  });
});
