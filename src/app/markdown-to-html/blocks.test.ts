import { describe, expect, it } from "vitest";
import { analyzeDocumentSemantics, stringTextSource } from "../../semantics/document";
import { CSS } from "../../constants/css-classes";
import { renderNode } from "./blocks";
import { mdParser, type WalkContext } from "./shared";

function renderDocument(doc: string): string {
  const tree = mdParser.parse(doc);
  const semantics = analyzeDocumentSemantics(stringTextSource(doc), tree);
  const context: WalkContext = {
    doc,
    sectionNumbers: false,
    semantics,
    surface: "document-body",
    citedIds: [],
    citationBacklinks: new Map(),
    nextCitationOccurrence: { value: 0 },
  };
  return renderNode(tree.topNode, context);
}

describe("blocks module", () => {
  it("skips YAML frontmatter when rendering the document node", () => {
    const html = renderDocument("---\ntitle: Test\n---\n\n# Hello");

    expect(html).not.toContain("title: Test");
    expect(html).toContain("<h1>Hello</h1>");
  });

  it("skips CRLF YAML frontmatter with the canonical boundary parser", () => {
    const html = renderDocument("---\r\ntitle: Test\r\n---\r\n\r\n# Hello");

    expect(html).not.toContain("title: Test");
    expect(html).toContain("<h1>Hello</h1>");
  });

  it("does not skip a leading thematic break as frontmatter", () => {
    const html = renderDocument("---\n\n# Hello");

    expect(html).toContain("<hr>");
    expect(html).toContain("<h1>Hello</h1>");
  });

  it("skips malformed YAML frontmatter after a valid boundary", () => {
    const html = renderDocument("---\ntitle: [\n---\n\n# Hello");

    expect(html).not.toContain("title: [");
    expect(html).toContain("<h1>Hello</h1>");
  });

  it("keeps proof labels inline when the body starts with a paragraph", () => {
    const html = renderDocument("::: {.proof}\nProof text.\n:::");

    expect(html).toContain(`<p><span class="${CSS.blockHeaderRendered}">Proof</span>`);
    expect(html).toContain("Proof text.</p>");
  });
});
