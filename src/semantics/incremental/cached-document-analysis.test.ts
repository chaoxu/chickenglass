import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDocumentAnalysisCache,
  getCachedDocumentAnalysis,
  getDocumentAnalysis,
  rememberDocumentAnalysis,
} from "./cached-document-analysis";
import {
  getDocumentAnalysisRevision,
  getDocumentAnalysisSliceRevision,
} from "./engine";

beforeEach(() => {
  clearDocumentAnalysisCache();
});

describe("shared document analysis cache", () => {
  it("reuses object identity for unchanged text at the same cache key", () => {
    const path = "notes/cache-identity.md";
    const first = getDocumentAnalysis("# Title\n", path);
    const second = getDocumentAnalysis("# Title\n", path);

    expect(second).toBe(first);
  });

  it("continues incremental updates after adopting external analysis", () => {
    const path = "notes/cache-adoption.md";
    const initialText = "# Title\n\nParagraph.\n";
    const external = getCachedDocumentAnalysis(initialText).analysis;

    expect(rememberDocumentAnalysis(initialText, external, path)).toBe(external);
    expect(getDocumentAnalysis(initialText, path)).toBe(external);

    const after = getDocumentAnalysis(
      "# Title\n\nParagraph with [@ref].\n",
      path,
    );

    expect(getDocumentAnalysisRevision(after)).toBe(
      getDocumentAnalysisRevision(external) + 1,
    );
    expect(getDocumentAnalysisSliceRevision(after, "references")).toBe(
      getDocumentAnalysisSliceRevision(external, "references") + 1,
    );
    expect(getDocumentAnalysisSliceRevision(after, "headings")).toBe(
      getDocumentAnalysisSliceRevision(external, "headings"),
    );
  });
});
