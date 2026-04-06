import { describe, expect, it } from "vitest";
import { scorePageCandidate } from "./chrome-common.mjs";

describe("chrome common page scoring", () => {
  it("rejects stale chrome and blank pages", () => {
    expect(scorePageCandidate("chrome-error://chromewebdata/", {
      targetUrl: "http://localhost:5173",
    })).toBe(Number.NEGATIVE_INFINITY);
    expect(scorePageCandidate("about:blank", {
      targetUrl: "http://localhost:5173",
    })).toBe(Number.NEGATIVE_INFINITY);
  });

  it("prefers the exact app url over unrelated localhost pages", () => {
    const exact = scorePageCandidate("http://localhost:5173", {
      targetUrl: "http://localhost:5173",
    });
    const sameOrigin = scorePageCandidate("http://localhost:5173/posts/demo", {
      targetUrl: "http://localhost:5173",
    });
    const otherLocalhost = scorePageCandidate("http://localhost:4173", {
      targetUrl: "http://localhost:5173",
    });

    expect(exact).toBeGreaterThan(sameOrigin);
    expect(sameOrigin).toBeGreaterThan(otherLocalhost);
  });
});
