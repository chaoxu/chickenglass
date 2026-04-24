import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MemoryFileSystem } from "../../app/file-manager";
import { buildDocumentLabelGraph } from "../../lib/markdown/labels";
import { buildFootnoteDefinitionMap } from "../markdown/footnotes";
import { buildRenderIndex } from "../markdown/reference-index";
import { LexicalRenderContextProvider, type LexicalRenderContextValue } from "../render-context";
import { ReferenceRenderer } from "./reference-renderer";

function createRenderContext(doc: string): LexicalRenderContextValue {
  return {
    citations: {
      backlinks: new Map(),
      citedIds: ["real-cite"],
      store: new Map([
        ["real-cite", {
          id: "real-cite",
          title: "Real citation",
          type: "book",
        }],
      ]),
    },
    config: {},
    doc,
    docPath: "index.md",
    footnoteDefinitions: buildFootnoteDefinitionMap(doc),
    fs: new MemoryFileSystem(),
    labelGraph: buildDocumentLabelGraph(doc),
    renderIndex: buildRenderIndex(doc),
    resolveAssetUrl: () => null,
  };
}

describe("ReferenceRenderer", () => {
  it("marks mixed local/citation clusters as citation backlink anchors", () => {
    const doc = [
      "$$x^2$$ {#eq:sum}",
      "",
      "See [@eq:sum; @real-cite].",
    ].join("\n");

    const { container } = render(
      <LexicalRenderContextProvider doc={doc} value={createRenderContext(doc)}>
        <ReferenceRenderer nodeKey="ref-1" raw="[@eq:sum; @real-cite]" />
      </LexicalRenderContextProvider>,
    );

    const reference = container.querySelector(".cf-lexical-reference");
    expect(reference?.getAttribute("data-coflat-citation")).toBe("true");
    expect(reference?.getAttribute("data-coflat-reference")).toBe("true");
  });
});
