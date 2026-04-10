import { afterEach, describe, expect, it, vi } from "vitest";

import {
  normalizeConnectEditorOptions,
  resolveTextAnchorInDocument,
  waitForAppUrl,
} from "./test-helpers.mjs";

describe("test helpers browser harness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults automated harnesses to a managed headless browser when requested", () => {
    expect(normalizeConnectEditorOptions({ browser: "managed" })).toMatchObject({
      browser: "managed",
      headless: true,
      port: 9322,
      url: "http://localhost:5173",
      viewport: { width: 1280, height: 900 },
    });
  });

  it("preserves the legacy cdp lane by default", () => {
    expect(normalizeConnectEditorOptions()).toMatchObject({
      browser: "cdp",
      headless: false,
      port: 9322,
      url: "http://localhost:5173",
    });
  });

  it("waits for the app url to become reachable", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await waitForAppUrl("http://localhost:5173", {
      intervalMs: 0,
      timeout: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("text anchors", () => {
  it("counts repeated matches on the same line as separate occurrences", () => {
    const documentText = "alpha beta alpha\ngamma alpha";

    expect(resolveTextAnchorInDocument(documentText, "alpha", { occurrence: 1 })).toEqual({
      line: 1,
      col: 1,
      anchor: 0,
    });
    expect(resolveTextAnchorInDocument(documentText, "alpha", { occurrence: 2 })).toEqual({
      line: 1,
      col: 12,
      anchor: 11,
    });
    expect(resolveTextAnchorInDocument(documentText, "alpha", { occurrence: 3 })).toEqual({
      line: 2,
      col: 7,
      anchor: 23,
    });
  });

  it("clamps offsets within the matched line bounds", () => {
    const documentText = "alpha\nbeta";

    expect(resolveTextAnchorInDocument(documentText, "alpha", { occurrence: 1, offset: -5 })).toEqual({
      line: 1,
      col: 1,
      anchor: 0,
    });
    expect(resolveTextAnchorInDocument(documentText, "alpha", { occurrence: 1, offset: 99 })).toEqual({
      line: 1,
      col: 6,
      anchor: 5,
    });
  });

  it("rejects non-positive occurrences", () => {
    expect(() => resolveTextAnchorInDocument("alpha", "alpha", { occurrence: 0 })).toThrow(
      "Text anchor occurrence must be a positive integer; got 0.",
    );
  });
});
