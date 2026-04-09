import { describe, expect, it } from "vitest";
import { analyzeMarkdownDocument, analyzeMarkdownSemantics } from "./markdown-analysis";

describe("markdown analysis", () => {
  it("exposes canonical IR alongside document analysis for non-CM6 callers", () => {
    const doc = [
      "---",
      "title: Test Document",
      "---",
      "",
      "# Intro {#sec:intro}",
      "",
      "See [@eq:test].",
      "",
      "$$x^2$$ {#eq:test}",
      "",
      "| A |",
      "| --- |",
      "| 1 |",
      "",
    ].join("\n");

    const result = analyzeMarkdownDocument(doc);

    expect(result.analysis).toEqual(analyzeMarkdownSemantics(doc));
    expect(result.ir.metadata.title).toBe("Test Document");
    expect(result.ir.sections[0]).toMatchObject({
      heading: "Intro",
      id: "sec:intro",
    });
    expect(result.ir.references[0]?.ids).toEqual(["eq:test"]);
    expect(result.ir.tables[0]?.rows[0]?.cells[0]?.content).toBe("1");
  });
});
