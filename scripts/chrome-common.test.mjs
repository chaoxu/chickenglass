import { describe, expect, it } from "vitest";
import { parseChromeArgs, scorePageCandidate } from "./chrome-common.mjs";

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

  it("supports a managed browser default for automated harnesses", () => {
    const args = parseChromeArgs([], { browser: "managed" });

    expect(args.browser).toBe("managed");
    expect(args.headless).toBe(true);
    expect(args.url).toBe("http://localhost:5173");
  });

  it("lets headed/headless flags override the default harness mode", () => {
    expect(parseChromeArgs(["--headed"], { browser: "managed" }).headless).toBe(false);
    expect(parseChromeArgs(["--headless"], { browser: "cdp" }).headless).toBe(true);
  });

  it("accepts equals-form browser flags through the shared parser", () => {
    const args = parseChromeArgs(["--browser=managed", "--port=9333", "--url=http://localhost:5178"]);

    expect(args.browser).toBe("managed");
    expect(args.port).toBe(9333);
    expect(args.url).toBe("http://localhost:5178");
  });
});
