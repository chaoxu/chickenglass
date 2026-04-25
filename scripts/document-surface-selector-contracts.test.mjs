import { describe, expect, it } from "vitest";

import {
  documentSurfaceSelector,
  documentSurfaceSelectorSnapshot,
  documentSurfaceWaitSelector,
  normalizeDocumentSurfaceMode,
} from "./document-surface-selector-contracts.mjs";

describe("document surface selector contracts", () => {
  it("normalizes product-facing mode names", () => {
    expect(normalizeDocumentSurfaceMode("rich")).toBe("cm6-rich");
    expect(normalizeDocumentSurfaceMode("CM6 Rich")).toBe("cm6-rich");
    expect(normalizeDocumentSurfaceMode("Lexical")).toBe("lexical");
  });

  it("resolves mode-specific surface selectors", () => {
    expect(documentSurfaceSelector("surface", "cm6-rich")).toBe(".cf-doc-surface--cm6");
    expect(documentSurfaceSelector("surface", "lexical")).toBe(".cf-doc-surface--lexical");
    expect(documentSurfaceSelector("headingH1", "lexical")).toBe(".cf-doc-heading--h1");
  });

  it("provides a stable selector snapshot for browser parity tests", () => {
    expect(documentSurfaceSelectorSnapshot("lexical")).toEqual({
      block: ".cf-doc-block",
      displayMath: ".cf-doc-display-math",
      flow: ".cf-doc-flow--lexical",
      headingH1: ".cf-doc-heading--h1",
      paragraph: ".cf-doc-paragraph",
      surface: ".cf-doc-surface--lexical",
      table: ".cf-doc-table-block",
      tableCell: ".cf-doc-table-block th, .cf-doc-table-block td",
    });
    expect(documentSurfaceWaitSelector("cm6-rich")).toContain(".cf-doc-flow--cm6");
  });

  it("fails loudly for unknown selector concepts", () => {
    expect(() => documentSurfaceSelector("unknown")).toThrow(
      "Unknown document surface selector: unknown",
    );
  });
});
