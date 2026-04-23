import { describe, expect, it } from "vitest";

import { CSS } from "../constants/css-classes";
import { CitationWidget } from "./citation-widget";

describe("CitationWidget", () => {
  it("creates a span with citation text", () => {
    const widget = new CitationWidget("(Karger, 2000)", ["karger2000"]);
    const el = widget.toDOM();
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe(CSS.citation);
    expect(el.textContent).toBe("(Karger, 2000)");
    expect(el.getAttribute("aria-label")).toBe("karger2000");
  });

  it("shows multiple ids in aria-label", () => {
    const widget = new CitationWidget("(Karger, 2000; Stein, 2001)", [
      "karger2000",
      "stein2001",
    ]);
    const el = widget.toDOM();
    expect(el.getAttribute("aria-label")).toBe("karger2000; stein2001");
  });

  it("eq returns true for same text", () => {
    const a = new CitationWidget("(Karger, 2000)", ["karger2000"]);
    const b = new CitationWidget("(Karger, 2000)", ["karger2000"]);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different text", () => {
    const a = new CitationWidget("(Karger, 2000)", ["karger2000"]);
    const b = new CitationWidget("(Stein, 2001)", ["stein2001"]);
    expect(a.eq(b)).toBe(false);
  });
});
