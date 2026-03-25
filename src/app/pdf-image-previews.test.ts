import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../lib/types";

const { loadPdfPreviewMock } = vi.hoisted(() => ({
  loadPdfPreviewMock: vi.fn(),
}));

vi.mock("../render/pdf-preview-cache", () => ({
  loadPdfPreview: loadPdfPreviewMock,
}));

import { resolvePdfImageOverrides } from "./pdf-image-previews";

function createMockFs(): FileSystem {
  return {
    listTree: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    createFile: vi.fn(),
    exists: vi.fn(),
    renameFile: vi.fn(),
    createDirectory: vi.fn(),
    deleteFile: vi.fn(),
    writeFileBinary: vi.fn(),
    readFileBinary: vi.fn(),
  };
}

describe("resolvePdfImageOverrides", () => {
  beforeEach(() => {
    loadPdfPreviewMock.mockReset();
    loadPdfPreviewMock.mockResolvedValue(null);
  });

  it("resolves local PDF targets relative to the current document", async () => {
    const fs = createMockFs();
    loadPdfPreviewMock.mockImplementation(async (path: string) => {
      if (path === "notes/figures/plot.pdf") return "data:image/png;base64,PLOT";
      if (path === "shared/proof.PDF") return "data:image/png;base64,PROOF";
      return null;
    });

    const content = [
      "![Plot](figures/plot.pdf)",
      "![Photo](photo.png)",
      "![Remote](https://example.com/paper.pdf)",
      "![Proof](../shared/proof.PDF)",
    ].join("\n\n");

    const overrides = await resolvePdfImageOverrides(content, fs, "notes/main.md");

    expect(loadPdfPreviewMock).toHaveBeenCalledTimes(2);
    expect(loadPdfPreviewMock).toHaveBeenNthCalledWith(1, "notes/figures/plot.pdf", fs);
    expect(loadPdfPreviewMock).toHaveBeenNthCalledWith(2, "shared/proof.PDF", fs);
    expect(overrides).toEqual(new Map([
      ["notes/figures/plot.pdf", "data:image/png;base64,PLOT"],
      ["shared/proof.PDF", "data:image/png;base64,PROOF"],
    ]));
  });

  it("deduplicates repeated references to the same resolved PDF path", async () => {
    const fs = createMockFs();
    loadPdfPreviewMock.mockResolvedValue("data:image/png;base64,FIGURE");

    const overrides = await resolvePdfImageOverrides([
      "![A](fig.pdf)",
      "![B](./fig.pdf)",
      "![C](fig.pdf)",
    ].join("\n\n"), fs, "notes/main.md");

    expect(loadPdfPreviewMock).toHaveBeenCalledTimes(1);
    expect(loadPdfPreviewMock).toHaveBeenCalledWith("notes/fig.pdf", fs);
    expect(overrides).toEqual(new Map([
      ["notes/fig.pdf", "data:image/png;base64,FIGURE"],
    ]));
  });

  it("returns an empty override map when no filesystem is available", async () => {
    const overrides = await resolvePdfImageOverrides("![A](fig.pdf)", undefined, "notes/main.md");

    expect(overrides).toEqual(new Map());
    expect(loadPdfPreviewMock).not.toHaveBeenCalled();
  });
});
