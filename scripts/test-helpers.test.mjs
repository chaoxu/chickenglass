import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildViteDevArgs,
  createArgParser,
  isLoopbackAppUrl,
  normalizeConnectEditorOptions,
  resolveTextAnchorInDocument,
  screenshot,
  waitForDebugBridge,
  waitForAppUrl,
} from "./test-helpers.mjs";
import { splitCliCommand } from "./devx-cli.mjs";

describe("test helpers browser harness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.__app;
    delete window.__editor;
    delete window.__cmView;
    delete window.__cmDebug;
    delete window.__cfDebug;
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

  it("recognizes loopback app urls and builds strict Vite dev args", () => {
    expect(isLoopbackAppUrl("http://localhost:5173")).toBe(true);
    expect(isLoopbackAppUrl("https://127.0.0.1:4443")).toBe(true);
    expect(isLoopbackAppUrl("https://example.com")).toBe(false);
    expect(buildViteDevArgs("http://localhost:5174")).toEqual([
      "dev",
      "--",
      "--host",
      "localhost",
      "--port",
      "5174",
      "--strictPort",
    ]);
  });

  it.each([
    ["__app.ready", "__app"],
    ["__editor.ready", "__editor"],
    ["__cfDebug.ready", "__cfDebug"],
  ])("reports the stuck %s readiness promise", async (expectedPending, stuckGlobal) => {
    const stuck = new Promise(() => {});
    window.__app = { ready: stuckGlobal === "__app" ? stuck : Promise.resolve() };
    window.__editor = { ready: stuckGlobal === "__editor" ? stuck : Promise.resolve() };
    window.__cfDebug = { ready: stuckGlobal === "__cfDebug" ? stuck : Promise.resolve() };
    window.__cmView = {};
    window.__cmDebug = {};
    const page = {
      waitForFunction: vi.fn(async () => {}),
      evaluate: vi.fn(async (fn, arg) => fn(arg)),
      title: vi.fn(async () => "Coflat"),
      url: vi.fn(() => "http://localhost:5173/"),
      context: vi.fn(() => ({ browser: () => null })),
    };

    await expect(waitForDebugBridge(page, { timeout: 10 })).rejects.toThrow(
      `pending: ${expectedPending}`,
    );
    expect(page.waitForFunction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 10,
      polling: 100,
    });
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });
});

describe("screenshot", () => {
  it("does not use the fresh-page fallback for buffer captures by default", async () => {
    const error = new Error("capture failed");
    const page = {
      screenshot: vi.fn(async () => {
        throw error;
      }),
    };

    await expect(screenshot(page, {
      clip: { x: 0, y: 0, width: 10, height: 10 },
      timeout: 10,
    })).rejects.toThrow("capture failed");
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

describe("createArgParser", () => {
  it("parses integer flags", () => {
    const { getIntFlag } = createArgParser(["--timeout", "30000", "--offset", "-4"]);

    expect(getIntFlag("--timeout", 15000)).toBe(30000);
    expect(getIntFlag("--offset", 0)).toBe(-4);
  });

  it("returns the fallback for missing integer flags", () => {
    const { getIntFlag } = createArgParser([]);

    expect(getIntFlag("--timeout", 15000)).toBe(15000);
  });

  it("rejects invalid integer flags", () => {
    const { getIntFlag } = createArgParser(["--iterations", "nope"]);

    expect(() => getIntFlag("--iterations", 3)).toThrow(
      "Invalid integer value for --iterations: nope",
    );
  });

  it("rejects partially numeric integer flags", () => {
    const { getIntFlag } = createArgParser(["--timeout", "15s"]);

    expect(() => getIntFlag("--timeout", 15000)).toThrow(
      "Invalid integer value for --timeout: 15s",
    );
  });

  it("collects positionals without treating flag values as files", () => {
    expect(
      createArgParser([
        "--url",
        "http://localhost:5174",
        "index.md",
        "--output",
        "/tmp/shot.png",
      ]).getPositionals(),
    ).toEqual(["index.md"]);
    expect(
      createArgParser([
        "index.md",
        "--url",
        "http://localhost:5174",
      ]).getPositionals(),
    ).toEqual(["index.md"]);
  });
});

describe("splitCliCommand", () => {
  it("normalizes npm -- separators and extracts known subcommands", () => {
    expect(splitCliCommand(["--", "compare", "--scenario", "open-index"], ["capture", "compare"], "capture")).toEqual({
      command: "compare",
      options: ["--scenario", "open-index"],
      hasExplicitCommand: true,
    });
  });

  it("falls back to the default command when no known subcommand is present", () => {
    expect(splitCliCommand(["--scenario", "open-index"], ["capture", "compare"], "capture")).toEqual({
      command: "capture",
      options: ["--scenario", "open-index"],
      hasExplicitCommand: false,
    });
  });
});
