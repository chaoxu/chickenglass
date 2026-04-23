import { describe, expect, it } from "vitest";

import { createLexicalRenderResourceResolver } from "../lexical/runtime/controller/resource-resolver";
import { buildCitationRenderData, loadBibliographyResource } from "./citation-render-data";

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
});
