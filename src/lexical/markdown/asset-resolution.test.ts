import { describe, expect, it } from "vitest";

import { buildStaticAssetUrl } from "./asset-resolution";

describe("buildStaticAssetUrl", () => {
  it("rewrites relative document assets into demo URLs", () => {
    expect(buildStaticAssetUrl("notes/main.md", "images/example figure.png")).toBe(
      "/demo/notes/images/example%20figure.png",
    );
  });

  it("leaves absolute and remote assets untouched", () => {
    expect(buildStaticAssetUrl("notes/main.md", "/images/example.png")).toBe("/images/example.png");
    expect(buildStaticAssetUrl("notes/main.md", "https://example.com/image.png")).toBe("https://example.com/image.png");
    expect(buildStaticAssetUrl("notes/main.md", "//cdn.example.com/image.png")).toBe("//cdn.example.com/image.png");
    expect(buildStaticAssetUrl("notes/main.md", "data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
  });

  it("rejects unsafe relative segments when no document path is available", () => {
    expect(buildStaticAssetUrl(undefined, "../private.png")).toBeNull();
  });
});
