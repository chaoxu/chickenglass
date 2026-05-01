import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { bibDataEffect } from "../state/bib-data";
import { CslProcessor } from "../citations/csl-processor";
import { CSS } from "../constants/css-classes";
import { collectReferenceRanges } from "./reference-render";
import { makeBibStore } from "../test-utils";
import {
  createView,
  expectPresent,
  revealReferenceAt,
  store,
  widgetClass,
} from "./reference-render-test-utils";

describe("collectReferenceRanges edge-cases", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
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
