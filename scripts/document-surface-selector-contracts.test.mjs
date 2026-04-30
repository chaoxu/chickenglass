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
  });

  it("resolves mode-specific surface selectors", () => {
    expect(documentSurfaceSelector("surface", "cm6-rich")).toBe(".cf-doc-surface");
    expect(documentSurfaceSelector("headingH1", "cm6-rich")).toBe(".cf-doc-heading--h1");
  });

  it("provides a stable selector snapshot for browser regression tests", () => {
    expect(documentSurfaceSelectorSnapshot("cm6-rich")).toEqual({
      block: ".cf-doc-block",
      displayMath: ".cf-doc-display-math",
      flow: ".cf-doc-flow",
      headingH1: ".cf-doc-heading--h1",
      paragraph: ".cf-doc-paragraph",
      surface: ".cf-doc-surface",
      table: ".cf-doc-table-block",
      tableCell: ".cf-doc-table-block th, .cf-doc-table-block td",
    });
    expect(documentSurfaceWaitSelector("cm6-rich")).toContain(".cf-doc-flow");
  });

  it("fails loudly for unknown selector concepts", () => {
    expect(() => documentSurfaceSelector("unknown")).toThrow(
      "Unknown document surface selector: unknown",
    );
  });
});
