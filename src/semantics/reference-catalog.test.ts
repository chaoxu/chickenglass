import { describe, expect, it } from "vitest";
import { ChangeSet } from "@codemirror/state";
import { analyzeMarkdownSemantics } from "./markdown-analysis";
import {
  buildDocumentReferenceCatalog,
  getPreferredDocumentReferenceTarget,
  mapDocumentReferenceCatalog,
} from "./reference-catalog";

describe("buildDocumentReferenceCatalog", () => {
  it("includes unlabeled structural targets while indexing labeled ids separately", () => {
    const analysis = analyzeMarkdownSemantics([
      "# Intro",
      "",
      "::: {.proof}",
      "Argument.",
      ":::",
      "",
      "## Background {#sec:background}",
    ].join("\n"));

    const catalog = buildDocumentReferenceCatalog(analysis);

    expect(catalog.targets.map((target) => [target.kind, target.id ?? null])).toEqual([
      ["heading", null],
      ["block", null],
      ["heading", "sec:background"],
    ]);
    expect(catalog.targetsById.has("sec:background")).toBe(true);
    expect(catalog.targetsById.has("missing")).toBe(false);
  });

  it("prefers block targets over other local definitions with the same id", () => {
    const doc = [
      "# Duplicate {#dup}",
      "",
      "::: {.theorem #dup} Main Result",
      "Body.",
      ":::",
      "",
      "$$x$$ {#eq:main}",
    ].join("\n");
    const analysis = analyzeMarkdownSemantics(doc);
    const theorem = analysis.fencedDivs.find((div) => div.id === "dup");
    expect(theorem).toBeDefined();

    const catalog = buildDocumentReferenceCatalog(analysis, {
      blocks: theorem
        ? [{
          from: theorem.from,
          to: theorem.to,
          id: theorem.id,
          blockType: theorem.primaryClass ?? "div",
          title: theorem.title,
          displayTitle: "Theorem",
          number: 1,
        }]
        : [],
    });

    expect(catalog.duplicatesById.get("dup")).toHaveLength(2);
    expect(getPreferredDocumentReferenceTarget(catalog, "dup")).toMatchObject({
      kind: "block",
      displayLabel: "Theorem 1",
    });
    expect(getPreferredDocumentReferenceTarget(catalog, "eq:main")).toMatchObject({
      kind: "equation",
      displayLabel: "Eq. (1)",
    });
  });

  it("preserves duplicate and preferred target lookup when mapping positions", () => {
    const doc = [
      "# Duplicate {#dup}",
      "",
      "::: {.theorem #dup} Main Result",
      "Body.",
      ":::",
      "",
      "$$x$$ {#eq:main}",
    ].join("\n");
    const analysis = analyzeMarkdownSemantics(doc);
    const theorem = analysis.fencedDivs.find((div) => div.id === "dup");
    expect(theorem).toBeDefined();

    const catalog = buildDocumentReferenceCatalog(analysis, {
      blocks: theorem
        ? [{
          from: theorem.from,
          to: theorem.to,
          id: theorem.id,
          blockType: theorem.primaryClass ?? "div",
          title: theorem.title,
          displayTitle: "Theorem",
          number: 1,
        }]
        : [],
    });

    const changes = ChangeSet.of([{ from: 0, insert: "Intro.\n\n" }], doc.length);
    const mapped = mapDocumentReferenceCatalog(catalog, changes);

    expect(mapped.duplicatesById.get("dup")).toHaveLength(2);
    expect(getPreferredDocumentReferenceTarget(mapped, "dup")).toMatchObject({
      kind: "block",
      displayLabel: "Theorem 1",
      from: theorem!.from + 8,
    });
    expect(getPreferredDocumentReferenceTarget(mapped, "eq:main")).toMatchObject({
      kind: "equation",
      displayLabel: "Eq. (1)",
    });
  });
});
