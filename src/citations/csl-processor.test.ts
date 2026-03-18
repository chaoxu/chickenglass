import { describe, expect, it } from "vitest";
import { parseLocator } from "./csl-processor";

describe("parseLocator", () => {
  it("parses chapter abbreviation", () => {
    expect(parseLocator("chap. 36")).toEqual({ label: "chapter", locator: "36" });
  });

  it("parses page abbreviation (plural)", () => {
    expect(parseLocator("pp. 100-120")).toEqual({ label: "page", locator: "100-120" });
  });

  it("parses page abbreviation (singular)", () => {
    expect(parseLocator("p. 42")).toEqual({ label: "page", locator: "42" });
  });

  it("parses full word labels", () => {
    expect(parseLocator("section 3.2")).toEqual({ label: "section", locator: "3.2" });
  });

  it("parses volume abbreviation", () => {
    expect(parseLocator("vol. 2")).toEqual({ label: "volume", locator: "2" });
  });

  it("returns no label for unrecognized prefix", () => {
    expect(parseLocator("theorem 3")).toEqual({ locator: "theorem 3" });
  });

  it("handles leading/trailing whitespace", () => {
    expect(parseLocator("  chap. 5  ")).toEqual({ label: "chapter", locator: "5" });
  });

  it("returns raw text when label has no remaining value", () => {
    // "chap." with nothing after it — no locator value
    expect(parseLocator("chap.")).toEqual({ locator: "chap." });
  });
});
