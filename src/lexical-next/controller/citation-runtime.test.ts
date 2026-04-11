import { describe, expect, it } from "vitest";

import { MemoryFileSystem } from "../../app/file-manager";
import { buildCitationRenderData, loadBibliographyResource } from "./citation-runtime";
import { createLexicalRenderResourceResolver } from "./resource-resolver";

describe("loadBibliographyResource", () => {
  it("loads bibliography entries through the shared resource resolver", async () => {
    const resolver = createLexicalRenderResourceResolver(new MemoryFileSystem({
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
});
