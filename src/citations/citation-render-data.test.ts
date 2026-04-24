import { describe, expect, it } from "vitest";

import { extractFileIndex } from "../index/extract";
import { createLexicalRenderResourceResolver } from "../lexical/runtime/controller/resource-resolver";
import { analyzeMarkdownDocument } from "../semantics/markdown-analysis";
import {
  buildCitationRenderData,
  buildCitationRenderDataFromAnalysis,
  loadBibliographyResource,
} from "./citation-render-data";

function createTextFileReader(files: Record<string, string>) {
  return {
    async readFile(path: string): Promise<string> {
      const content = files[path];
      if (content === undefined) {
        throw new Error(`missing file: ${path}`);
      }
      return content;
    },
  };
}

describe("loadBibliographyResource", () => {
  it("loads bibliography entries through the shared resource resolver", async () => {
    const resolver = createLexicalRenderResourceResolver(createTextFileReader({
      "notes/main.md": "# Main",
      "notes/refs/library.bib": [
        "@book{cite:knuth,",
        "  title = {Literate Programming},",
        "  author = {Knuth, Donald},",
        "  year = {1984}",
        "}",
      ].join("\n"),
    }), "notes/main.md");

    const bibliography = await loadBibliographyResource({
      bibliography: "refs/library.bib",
    }, resolver);

    expect(bibliography.store.get("cite:knuth")?.title).toBe("Literate Programming");
  });
});

describe("buildCitationRenderData", () => {
  it("derives cited ids and backlinks from the loaded bibliography without React", () => {
    const citations = buildCitationRenderData(
      "See [@cite:knuth; @cite:lamport] and [@cite:knuth].",
      {
        store: new Map([
          ["cite:knuth", {
            id: "cite:knuth",
            title: "Literate Programming",
            type: "book",
          }],
          ["cite:lamport", {
            id: "cite:lamport",
            title: "LaTeX",
            type: "book",
          }],
        ]),
      },
    );

    expect(citations.citedIds).toEqual(["cite:knuth", "cite:lamport"]);
    expect(citations.backlinks.get("cite:knuth")).toHaveLength(2);
    expect(citations.backlinks.get("cite:lamport")).toHaveLength(1);
  });

  it("ignores citation syntax embedded in inline code and fenced code blocks", () => {
    const citations = buildCitationRenderData(
      [
        "Use `@cite:knuth` as a literal token.",
        "",
        "```md",
        "[@cite:lamport]",
        "```",
        "",
        "See [@cite:tufte].",
      ].join("\n"),
      {
        store: new Map([
          ["cite:knuth", {
            id: "cite:knuth",
            title: "Literate Programming",
            type: "book",
          }],
          ["cite:lamport", {
            id: "cite:lamport",
            title: "LaTeX",
            type: "book",
          }],
          ["cite:tufte", {
            id: "cite:tufte",
            title: "The Visual Display of Quantitative Information",
            type: "book",
          }],
        ]),
      },
    );

    expect(citations.citedIds).toEqual(["cite:tufte"]);
    expect(citations.backlinks.get("cite:knuth")).toBeUndefined();
    expect(citations.backlinks.get("cite:lamport")).toBeUndefined();
    expect(citations.backlinks.get("cite:tufte")).toHaveLength(1);
  });

  it("excludes local markdown targets that collide with bibliography keys", () => {
    const citations = buildCitationRenderData(
      [
        "# Intro",
        "",
        "## Background {#cite:heading}",
        "",
        "::: {.theorem #cite:block}",
        "Statement.",
        ":::",
        "",
        "$$x^2$$ {#eq:cite}",
        "",
        "See [@cite:heading], [@cite:block], [@eq:cite], and [@cite:real].",
      ].join("\n"),
      {
        store: new Map([
          ["cite:heading", {
            id: "cite:heading",
            title: "Heading collision",
            type: "book",
          }],
          ["cite:block", {
            id: "cite:block",
            title: "Block collision",
            type: "book",
          }],
          ["eq:cite", {
            id: "eq:cite",
            title: "Equation collision",
            type: "book",
          }],
          ["cite:real", {
            id: "cite:real",
            title: "Actual citation",
            type: "book",
          }],
        ]),
      },
    );

    expect(citations.citedIds).toEqual(["cite:real"]);
    expect(citations.backlinks.get("cite:heading")).toBeUndefined();
    expect(citations.backlinks.get("cite:block")).toBeUndefined();
    expect(citations.backlinks.get("eq:cite")).toBeUndefined();
    expect(citations.backlinks.get("cite:real")).toHaveLength(1);
  });

  it("classifies citation targets through the same semantic artifacts as the index", () => {
    const content = [
      "# Intro {#cite:heading}",
      "",
      "::: {.theorem #cite:block}",
      "Statement.",
      ":::",
      "",
      "$$x^2$$ {#eq:cite}",
      "",
      "See [@cite:heading], [@cite:block], [@eq:cite], and [@cite:real].",
    ].join("\n");
    const artifacts = analyzeMarkdownDocument(content, "paper.md");
    const index = extractFileIndex(content, "paper.md", artifacts);
    const citations = buildCitationRenderDataFromAnalysis(
      artifacts.analysis,
      {
        store: new Map([
          ["cite:heading", {
            id: "cite:heading",
            title: "Heading collision",
            type: "book",
          }],
          ["cite:block", {
            id: "cite:block",
            title: "Block collision",
            type: "book",
          }],
          ["eq:cite", {
            id: "eq:cite",
            title: "Equation collision",
            type: "book",
          }],
          ["cite:real", {
            id: "cite:real",
            title: "Actual citation",
            type: "book",
          }],
        ]),
      },
    );

    expect(index.entries.map((entry) => entry.label).filter(Boolean)).toEqual([
      "cite:block",
      "eq:cite",
      "cite:heading",
    ]);
    expect(citations.citedIds).toEqual(["cite:real"]);
    expect([...citations.store.keys()]).toEqual(["cite:real"]);
  });
});
