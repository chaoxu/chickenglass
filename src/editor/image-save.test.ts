import { describe, it, expect, vi } from "vitest";
import {
  IMAGE_MIME_EXT,
  IMAGE_EXTENSIONS,
  isImageMime,
  generateImageFilename,
  altTextFromFilename,
  logImageError,
  saveAndInsertImage,
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

  it("strips path traversal segments from user-controlled filenames", () => {
    const file = new File([], "../../etc/passwd.png", { type: "image/png" });
    expect(generateImageFilename(file, "png")).toBe("passwd.png");
  });

  it("strips Windows path traversal segments from user-controlled filenames", () => {
    const file = new File([], "..\\..\\secrets\\diagram.png", { type: "image/png" });
    expect(generateImageFilename(file, "png")).toBe("diagram.png");
  });
});

describe("altTextFromFilename", () => {
  it("strips file extension", () => {
    expect(altTextFromFilename("my-diagram.png")).toBe("my-diagram");
  });

  it("strips only the last extension", () => {
    expect(altTextFromFilename("file.backup.jpg")).toBe("file.backup");
  });

  it("returns the name unchanged when there is no extension", () => {
    expect(altTextFromFilename("noext")).toBe("noext");
  });

  it("handles dotfiles", () => {
    expect(altTextFromFilename(".hidden")).toBe("");
  });
});

describe("logImageError", () => {
  it("logs with the correct prefix format", () => {
    const errors: unknown[][] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      logImageError("paste", new Error("test"));
      expect(errors).toHaveLength(1);
      expect(errors[0][0]).toBe("[coflat] image paste failed:");
      expect(errors[0][1]).toBeInstanceOf(Error);
    } finally {
      console.error = orig;
    }
  });
});

describe("IMAGE_EXTENSIONS", () => {
  it("contains every unique extension from IMAGE_MIME_EXT", () => {
    const expected = [...new Set(Object.values(IMAGE_MIME_EXT))];
    expect(IMAGE_EXTENSIONS).toEqual(expected);
  });

  it("has no duplicates", () => {
    expect(IMAGE_EXTENSIONS.length).toBe(new Set(IMAGE_EXTENSIONS).size);
  });
});

describe("saveAndInsertImage", () => {
  it("calls save then insert with correct path and alt text", async () => {
    const file = new File(["data"], "chart.png", { type: "image/png" });
    const save = vi.fn().mockResolvedValue("assets/chart.png");
    const insert = vi.fn();

    await saveAndInsertImage(file, save, insert, "test");

    expect(save).toHaveBeenCalledWith(file);
    expect(insert).toHaveBeenCalledWith("assets/chart.png", "chart");
  });

  it("logs errors from save without throwing", async () => {
    const file = new File(["data"], "bad.png", { type: "image/png" });
    const save = vi.fn().mockRejectedValue(new Error("disk full"));
    const insert = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await saveAndInsertImage(file, save, insert, "test");

    expect(insert).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[coflat] image test failed:",
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it("derives alt text from generated filename for unnamed files", async () => {
    const file = new File(["data"], "image.png", { type: "image/png" });
    const save = vi.fn().mockResolvedValue("assets/image-12345.png");
    const insert = vi.fn();

    await saveAndInsertImage(file, save, insert, "test");

    // Alt text comes from the generated filename, not the saved path
    const alt = insert.mock.calls[0][1] as string;
    expect(alt).toMatch(/^image-\d+$/);
  });

  it("produces identical results regardless of insertion path", async () => {
    // Simulate the same file going through paste, drop, and picker —
    // all three should produce the same save call and alt text.
    const fileData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const makeFile = () =>
      new File([fileData], "screenshot.png", { type: "image/png" });

    const savePath = "assets/screenshot.png";
    const results: Array<{ path: string; alt: string }> = [];

    for (const operation of ["paste", "drop", "insert"]) {
      const save = vi.fn().mockResolvedValue(savePath);
      const insert = vi.fn();

      await saveAndInsertImage(makeFile(), save, insert, operation);

      results.push({
        path: insert.mock.calls[0][0] as string,
        alt: insert.mock.calls[0][1] as string,
      });
    }

    // All three paths produce identical path and alt text
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
    expect(results[0].path).toBe(savePath);
    expect(results[0].alt).toBe("screenshot");
  });
});
