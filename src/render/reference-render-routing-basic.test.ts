import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { CSS } from "../constants/css-classes";
import { collectReferenceRanges } from "./reference-render";
import {
  createView,
  expectPresent,
  revealReferenceAt,
  store,
  widgetClass,
} from "./reference-render-test-utils";


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
});
