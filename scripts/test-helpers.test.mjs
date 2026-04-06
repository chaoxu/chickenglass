import { afterEach, describe, expect, it, vi } from "vitest";

import {
  normalizeConnectEditorOptions,
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
