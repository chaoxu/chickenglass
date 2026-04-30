import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MemoryFileSystem } from "../app/file-manager";
import { buildDocumentLabelGraph } from "../lib/markdown/labels";
import { buildFootnoteDefinitionMap } from "./markdown/footnotes";
import { buildRenderIndex } from "./markdown/reference-index";
import {
  LexicalRenderContextProvider,
  type LexicalRenderContextValue,
} from "./render-context";
import { useAssetPreview } from "./media-preview";
import { notifyLexicalMediaPreviewInvalidated } from "./media-preview-invalidation";

function createRenderContext(
  doc: string,
  fs: MemoryFileSystem,
): LexicalRenderContextValue {
  return {
    citations: {
      backlinks: new Map(),
      citedIds: [],
      store: new Map(),
    },
    config: {},
    doc,
    docPath: "notes/main.md",
    footnoteDefinitions: buildFootnoteDefinitionMap(doc),
    fs,
    labelGraph: buildDocumentLabelGraph(doc),
    renderIndex: buildRenderIndex(doc),
    resolveAssetUrl: () => null,
  };
}

function AssetPreviewProbe({ target }: { readonly target: string }) {
  const preview = useAssetPreview(target);
  return (
    <div
      data-testid="preview"
      data-kind={preview.kind}
      data-url={preview.previewUrl ?? ""}
    />
  );
}

describe("useAssetPreview", () => {
  it("reloads a local image preview when the watched resolved path is invalidated", async () => {
    const fs = new MemoryFileSystem({
      "notes/main.md": "![Figure](figure.png)",
    });
    await fs.writeFileBinary("notes/figure.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    const doc = "![Figure](figure.png)";
    render(
      <LexicalRenderContextProvider doc={doc} value={createRenderContext(doc, fs)}>
        <AssetPreviewProbe target="figure.png" />
      </LexicalRenderContextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("preview").getAttribute("data-url"))
        .toBe("data:image/png;base64,iVBORw==");
    });

    await act(async () => {
      await fs.writeFileBinary(
        "notes/figure.png",
        new Uint8Array([0x89, 0x50, 0x4e, 0x48]),
      );
      notifyLexicalMediaPreviewInvalidated("notes/figure.png");
    });

    await waitFor(() => {
      expect(screen.getByTestId("preview").getAttribute("data-url"))
        .toBe("data:image/png;base64,iVBOSA==");
    });
  });
});
