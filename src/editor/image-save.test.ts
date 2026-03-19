import { describe, it, expect } from "vitest";
import {
  IMAGE_MIME_EXT,
  isImageMime,
  generateImageFilename,
} from "./image-save";

describe("IMAGE_MIME_EXT", () => {
  it("maps common image MIME types to extensions", () => {
    expect(IMAGE_MIME_EXT["image/png"]).toBe("png");
    expect(IMAGE_MIME_EXT["image/jpeg"]).toBe("jpg");
    expect(IMAGE_MIME_EXT["image/gif"]).toBe("gif");
    expect(IMAGE_MIME_EXT["image/webp"]).toBe("webp");
    expect(IMAGE_MIME_EXT["image/svg+xml"]).toBe("svg");
  });

  it("does not include non-image types", () => {
    expect(IMAGE_MIME_EXT["text/plain"]).toBeUndefined();
    expect(IMAGE_MIME_EXT["application/pdf"]).toBeUndefined();
  });
});

describe("isImageMime", () => {
  it("returns true for supported image types", () => {
    expect(isImageMime("image/png")).toBe(true);
    expect(isImageMime("image/jpeg")).toBe(true);
    expect(isImageMime("image/gif")).toBe(true);
    expect(isImageMime("image/webp")).toBe(true);
    expect(isImageMime("image/svg+xml")).toBe(true);
    expect(isImageMime("image/bmp")).toBe(true);
    expect(isImageMime("image/tiff")).toBe(true);
  });

  it("returns false for unsupported types", () => {
    expect(isImageMime("text/plain")).toBe(false);
    expect(isImageMime("application/pdf")).toBe(false);
    expect(isImageMime("video/mp4")).toBe(false);
    expect(isImageMime("image/x-custom")).toBe(false);
  });
});

describe("generateImageFilename", () => {
  it("uses the file's own name when meaningful", () => {
    const file = new File([], "my-diagram.png", { type: "image/png" });
    expect(generateImageFilename(file, "png")).toBe("my-diagram.png");
  });

  it("generates a timestamp name for generic clipboard images", () => {
    const file = new File([], "image.png", { type: "image/png" });
    const result = generateImageFilename(file, "png");
    expect(result).toMatch(/^image-\d+\.png$/);
  });

  it("generates a timestamp name for blob files", () => {
    const file = new File([], "blob", { type: "image/png" });
    const result = generateImageFilename(file, "png");
    expect(result).toMatch(/^image-\d+\.png$/);
  });

  it("generates a timestamp name for empty-named files", () => {
    const file = new File([], "", { type: "image/jpeg" });
    const result = generateImageFilename(file, "jpg");
    expect(result).toMatch(/^image-\d+\.jpg$/);
  });
});
