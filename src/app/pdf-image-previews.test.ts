import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../lib/types";

const { rasterizeMock } = vi.hoisted(() => ({
  rasterizeMock: vi.fn(),
}));

vi.mock("../render/pdf-rasterizer", () => ({
  rasterizePdfPage1: rasterizeMock,
}));

import { resolveLocalImageOverrides } from "./pdf-image-previews";

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
    readFileBinary: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
  };
}

describe("resolveLocalImageOverrides", () => {
  beforeEach(() => {
    rasterizeMock.mockReset();
  });

  it("resolves local PDF targets relative to the current document", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;
    rasterizeMock.mockResolvedValue(canvas);

    const content = "# Title\n\n![fig](diagram.pdf)\n";
    const fs = createMockFs();
    await resolveLocalImageOverrides(content, fs, "posts/math.md");

    // In jsdom, canvas.toDataURL is not implemented — the override gets
    // filtered out. Just verify the pipeline ran correctly.
    expect(rasterizeMock).toHaveBeenCalledTimes(1);
    expect((fs.readFileBinary as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("posts/diagram.pdf");
  });

  it("deduplicates repeated references to the same resolved PDF path", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;
    rasterizeMock.mockResolvedValue(canvas);

    const content = "![a](fig.pdf)\n\n![b](fig.pdf)\n";
    const fs = createMockFs();
    await resolveLocalImageOverrides(content, fs, "doc.md");

    // Only one rasterization call despite two references (dedup by resolved path)
    expect(rasterizeMock).toHaveBeenCalledTimes(1);
  });

  it("loads non-PDF images as browser-safe data URLs", async () => {
    const content = "![img](photo.png)\n";
    const fs = createMockFs();
    const result = await resolveLocalImageOverrides(content, fs, "doc.md");
    expect(result.get("photo.png")).toBe("data:image/png;base64,JVBERg==");
    expect(rasterizeMock).not.toHaveBeenCalled();
    expect((fs.readFileBinary as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("photo.png");
  });

  it("deduplicates repeated references to the same resolved non-PDF path", async () => {
    const content = "![a](diagram.png)\n\n![b](diagram.png)\n";
    const fs = createMockFs();
    await resolveLocalImageOverrides(content, fs, "posts/math.md");

    expect(rasterizeMock).not.toHaveBeenCalled();
    expect((fs.readFileBinary as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((fs.readFileBinary as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("posts/diagram.png");
  });
});
