import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { bibDataEffect } from "../state/bib-data";
import { CslProcessor } from "../citations/csl-processor";
import { CSS } from "../constants/css-classes";
import { collectReferenceRanges } from "./reference-render";
import { renderPreviewBlockContentToDom } from "./preview-block-renderer";
import {
  createView,
  expectPresent,
  karger,
  stein,
  store,
  widgetClass,
} from "./reference-render-test-utils";


describe("collectReferenceRanges (clusters)", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

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

  it("renders preview heading crossrefs as first-class crossrefs", () => {
    const preview = document.createElement("div");
    renderPreviewBlockContentToDom(
      preview,
      [
        "# Intro",
        "",
        "## Result Section {#sec:result}",
        "",
        "See [@sec:result].",
      ].join("\n"),
    );

    const crossref = preview.querySelector(`.${CSS.crossref}`);
    expect(crossref?.textContent).toBe("Section 1.1");
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

  it("keeps CM6 widgets and block previews on the same presentation route", async () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "See [@eq:alpha; @karger2000].",
    ].join("\n");
    const editorProcessor = await CslProcessor.create([karger, stein]);
    const previewProcessor = await CslProcessor.create([karger, stein]);
    view = createView(doc, doc.length);
    view.dispatch({
      effects: bibDataEffect.of({
        store,
        cslProcessor: editorProcessor,
      }),
    });

    const ref = collectReferenceRanges(view, store, editorProcessor).find(
      (range) => view.state.sliceDoc(range.from, range.to) === "[@eq:alpha; @karger2000]",
    );
    expectPresent(ref, "reference range");
    const widget = ref.value.spec.widget;
    expect(widget).toBeDefined();
    if (!widget) return;
    const widgetText = (widget.toDOM() as HTMLElement).textContent;

    const preview = document.createElement("div");
    renderPreviewBlockContentToDom(preview, doc, {
      bibliography: store,
      cslProcessor: previewProcessor,
    });

    expect(preview.querySelector(`.${CSS.citation}`)?.textContent).toBe(widgetText);
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
});
