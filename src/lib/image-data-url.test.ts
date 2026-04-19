import { describe, expect, it } from "vitest";

import { readImageFileAsDataUrl } from "./image-data-url";

const encoder = new TextEncoder();

function makeFs(bytes: Uint8Array) {
  return {
    readFileBinary: async () => bytes,
  };
}

describe("readImageFileAsDataUrl", () => {
  it("encodes validated image bytes", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    await expect(readImageFileAsDataUrl("figure.png", makeFs(pngBytes)))
      .resolves.toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("rejects HTML fallback bytes for missing image paths", async () => {
    const htmlBytes = encoder.encode("<!doctype html><html><body>dev fallback</body></html>");

    await expect(readImageFileAsDataUrl("missing.png", makeFs(htmlBytes)))
      .resolves.toBeNull();
  });
});
