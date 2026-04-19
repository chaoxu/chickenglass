import { describe, expect, it } from "vitest";

import {
  computeEmbedSrc,
  embedSandboxPermissions,
  externalEmbedStubRoutes,
  findEmbedProvider,
} from "./embed-providers.js";

describe("embed providers", () => {
  it("matches supported provider URLs through the shared provider definitions", () => {
    expect(computeEmbedSrc("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
      .toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(computeEmbedSrc("youtube", "https://youtu.be/dQw4w9WgXcQ"))
      .toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(computeEmbedSrc("gist", "https://gist.github.com/chaoxu/6094392"))
      .toBe("https://gist.github.com/chaoxu/6094392.pibb");
  });

  it("keeps unknown providers generic and rejects invalid URLs", () => {
    expect(computeEmbedSrc("iframe", "https://example.com/embed")).toBe("https://example.com/embed");
    expect(computeEmbedSrc("youtube", "https://example.com/not-youtube")).toBeNull();
    expect(computeEmbedSrc("gist", "http://gist.github.com/chaoxu/6094392")).toBeNull();
    expect(findEmbedProvider("missing")).toBeNull();
  });

  it("exposes deterministic browser stub routes for external providers", () => {
    const routes = externalEmbedStubRoutes();
    expect(routes.map((route) => route.providerId)).toEqual(expect.arrayContaining(["youtube", "gist"]));
    expect(routes.find((route) => route.providerId === "youtube")?.routePattern.test(
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    )).toBe(true);
    expect(embedSandboxPermissions("youtube")).toContain("allow-presentation");
  });
});

