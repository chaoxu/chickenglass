import { describe, expect, it } from "vitest";

import { MemoryFileSystem } from "../app/file-manager";
import { buildDocumentLabelGraph } from "../app/markdown/labels";
import { createReferencePreviewBuilder } from "./hover-preview-plugin";
import type { LexicalRenderContextValue } from "./render-context";
import { buildFootnoteDefinitionMap } from "./markdown/footnotes";
import { buildRenderIndex } from "./markdown/reference-index";

function createRenderContext(doc: string): LexicalRenderContextValue {
  return {
    citations: {
      backlinks: new Map(),
      citedIds: [],
      store: new Map(),
    },
    config: {},
    doc,
    docPath: "index.md",
    footnoteDefinitions: buildFootnoteDefinitionMap(doc),
    fs: new MemoryFileSystem(),
    labelGraph: buildDocumentLabelGraph(doc),
    renderIndex: buildRenderIndex(doc),
    resolveAssetUrl: (targetPath: string) => targetPath,
  };
}

describe("createReferencePreviewBuilder", () => {
  it("reuses the same preview element for repeated lookups of the same id", () => {
    const context = createRenderContext([
      '::: {#thm:hover-preview .theorem title="Cached Title"}',
      "Body with **bold** text.",
      ":::",
    ].join("\n"));

    const buildPreview = createReferencePreviewBuilder(context);

    expect(buildPreview("thm:hover-preview")).toBe(buildPreview("thm:hover-preview"));
  });

  it("does not reuse cached previews across render contexts", () => {
    const firstBuilder = createReferencePreviewBuilder(createRenderContext([
      '::: {#thm:hover-preview .theorem title="First Title"}',
      "First body.",
      ":::",
    ].join("\n")));
    const secondBuilder = createReferencePreviewBuilder(createRenderContext([
      '::: {#thm:hover-preview .theorem title="Second Title"}',
      "Second body.",
      ":::",
    ].join("\n")));

    expect(firstBuilder("thm:hover-preview")).not.toBe(secondBuilder("thm:hover-preview"));
  });
});
