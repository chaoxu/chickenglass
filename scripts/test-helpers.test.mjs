import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as editorHelperSurface from "./editor-test-helpers.mjs";
import * as testHelperSurface from "./test-helpers.mjs";
import {
  buildViteDevArgs,
  createBrowserArtifactRecorder,
  isLoopbackAppUrl,
  normalizeConnectEditorOptions,
  openEditorScenario,
  resolveTextAnchorInDocument,
  runBrowserDoctor,
  screenshot,
  scrollTo,
  waitForAppUrl,
  waitForDebugBridge,
  waitForDocumentStable,
  waitForScrollReady,
  switchToMode,
} from "./test-helpers.mjs";

describe("test helpers browser harness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.__app;
    delete window.__editor;
    delete window.__cmView;
    delete window.__cmDebug;
    delete window.__cfDebug;
    document.body.innerHTML = "";
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

  it("keeps legacy navigation and structure helpers exported from both helper barrels", () => {
    const legacyHelperNames = [
      "activateStructureAtCursor",
      "clearMotionGuards",
      "clearStructure",
      "findLine",
      "jumpToTextAnchor",
      "pickAutocompleteOption",
      "readAutocompleteOptions",
      "resolveTextAnchorInDocument",
      "scrollTo",
      "scrollToText",
      "setCursor",
      "traceVerticalCursorMotion",
      "waitForAutocomplete",
    ];

    for (const helperName of legacyHelperNames) {
      expect(editorHelperSurface[helperName], `editor-test-helpers.${helperName}`).toEqual(
        expect.any(Function),
      );
      expect(testHelperSurface[helperName], `test-helpers.${helperName}`).toEqual(
        expect.any(Function),
      );
    }
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
    expect(page.waitForFunction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        requiredGlobals: ["__app", "__editor", "__cfDebug"],
      }),
      {
        timeout: 10,
        polling: 100,
      },
    );
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it("requires all debug bridge readiness promises to be present", async () => {
    window.__app = { ready: Promise.resolve() };
    window.__editor = {};
    window.__cfDebug = { ready: Promise.resolve() };
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
      "ready promises missing: __editor.ready",
    );
  });

  it("browser doctor reports wrong page attachments clearly", async () => {
    const page = {
      url: vi.fn(() => "http://localhost:5174/"),
    };

    await expect(runBrowserDoctor(page, {
      targetUrl: "http://localhost:5173/",
    })).rejects.toThrow("wrong app page");
  });

  it("browser doctor reports a Vite overlay before running scenarios", async () => {
    window.__app = {
      getMode: () => "lexical",
      ready: Promise.resolve(),
    };
    window.__editor = {
      getDoc: () => "hello",
      getSelection: () => ({ anchor: 0, focus: 0 }),
      ready: Promise.resolve(),
    };
    window.__cfDebug = {
      ready: Promise.resolve(),
    };
    document.body.innerHTML = "<vite-error-overlay>compile failed</vite-error-overlay><div data-testid='lexical-editor'></div>";
    const page = {
      context: vi.fn(() => ({ browser: () => null })),
      evaluate: vi.fn(async (fn, arg) => fn(arg)),
      title: vi.fn(async () => "Coflat"),
      url: vi.fn(() => "http://localhost:5173/"),
      waitForFunction: vi.fn(async (fn, arg) => {
        expect(fn(arg)).toBe(true);
      }),
    };

    await expect(runBrowserDoctor(page, {
      label: "overlay-check",
      targetUrl: "http://localhost:5173/",
      timeout: 10,
    })).rejects.toThrow("Vite error overlay visible");
  });

  it("waits for canonical document stability through the editor bridge", async () => {
    window.__app = { getMode: () => "cm6-rich" };
    window.__editor = { getDoc: () => "# Ready\n" };
    window.__cmDebug = { semantics: () => ({ revision: 3 }) };
    const page = {
      evaluate: vi.fn(async (fn, arg) => fn(arg)),
    };

    await expect(waitForDocumentStable(page, {
      quietMs: 0,
      timeoutMs: 100,
    })).resolves.toBe(true);
  });

  it("waits for stable CM6 scroll geometry before scroll probes", async () => {
    window.__app = { getMode: () => "cm6-rich" };
    window.__editor = { getDoc: () => "# Ready\n" };
    window.__cmDebug = { semantics: () => ({ revision: 3 }) };
    window.__cmView = {
      scrollDOM: {
        scrollHeight: 2000,
        clientHeight: 700,
        scrollTop: 120,
      },
      viewport: {
        from: 0,
        to: 8,
      },
    };
    const page = {
      evaluate: vi.fn(async (fn, arg) => fn(arg)),
      waitForFunction: vi.fn(async () => {}),
    };

    await expect(waitForScrollReady(page, {
      stableFrames: 1,
      timeoutMs: 200,
    })).resolves.toBeUndefined();
  });

  it("scrolls Lexical through the product-neutral editor bridge", async () => {
    const doc = "# One\n\nIntro\n\n## Target\n\nBody";
    const targetOffset = doc.indexOf("## Target");
    const surface = document.createElement("div");
    surface.className = "cf-lexical-surface--scroll";
    Object.defineProperty(surface, "clientHeight", { configurable: true, value: 300 });
    surface.getBoundingClientRect = () => ({
      bottom: 300,
      height: 300,
      left: 0,
      right: 700,
      top: 0,
      width: 700,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const root = document.createElement("div");
    root.className = "cf-lexical-editor";
    root.dataset.lexicalEditor = "true";
    const target = document.createElement("h2");
    target.dataset.coflatHeadingPos = String(targetOffset);
    target.textContent = "Target";
    target.getBoundingClientRect = () => ({
      bottom: 420,
      height: 40,
      left: 0,
      right: 700,
      top: 380,
      width: 700,
      x: 0,
      y: 380,
      toJSON: () => ({}),
    });
    root.append(target);
    surface.append(root);
    document.body.append(surface);

    const setSelection = vi.fn();
    const focus = vi.fn();
    window.__editor = {
      focus,
      getDoc: () => doc,
      setSelection,
    };
    const page = {
      evaluate: vi.fn(async (fn, arg) => fn(arg)),
    };

    await scrollTo(page, 5);

    expect(setSelection).toHaveBeenCalledWith(targetOffset, targetOffset);
    expect(focus).toHaveBeenCalled();
    expect(surface.scrollTop).toBe(280);
  });

  it("switches editor modes through the app debug bridge", async () => {
    let mode = "cm6-rich";
    window.__app = {
      getMode: () => mode,
      setMode: (nextMode) => {
        mode = nextMode;
      },
    };
    window.__editor = {
      getDoc: () => "# Ready\n",
    };
    window.__cmDebug = {
      semantics: () => ({ revision: 1 }),
    };
    const page = {
      evaluate: vi.fn(async (fn, arg) => fn(arg)),
      waitForFunction: vi.fn(async () => {}),
    };

    await switchToMode(page, "Lexical");

    expect(mode).toBe("lexical");
    expect(page.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ nextMode: "lexical" }),
    );
    expect(page.waitForFunction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        minCount: 1,
        selector: ".cf-doc-flow--lexical",
      }),
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("waits for CM6 mode-specific surface classes after switching modes", async () => {
    let mode = "cm6-rich";
    window.__app = {
      getMode: () => mode,
      setMode: (nextMode) => {
        mode = nextMode;
      },
    };
    window.__editor = {
      getDoc: () => "# Ready\n",
    };
    window.__cmDebug = {
      semantics: () => ({ revision: 1 }),
    };
    const page = {
      evaluate: vi.fn(async (fn, arg) => fn(arg)),
      waitForFunction: vi.fn(async (fn, arg) => {
        if (arg?.selector === ".cm-editor.cf-source-mode .cm-content") {
          document.body.innerHTML = "<div class='cm-editor cf-source-mode'><div class='cm-content cf-doc-flow--cm6'></div></div>";
        } else if (arg?.selector === ".cm-editor:not(.cf-source-mode) .cf-doc-flow--cm6") {
          document.body.innerHTML = "<div class='cm-editor'><div class='cm-content cf-doc-flow--cm6'></div></div>";
        }
        expect(fn(arg)).toBe(true);
      }),
    };

    await switchToMode(page, "Source");
    await switchToMode(page, "CM6 Rich");

    expect(page.waitForFunction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        minCount: 1,
        selector: ".cm-editor.cf-source-mode .cm-content",
      }),
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(page.waitForFunction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        minCount: 1,
        selector: ".cm-editor:not(.cf-source-mode) .cf-doc-flow--cm6",
      }),
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("opens generated multi-file editor scenarios through the app bridge", async () => {
    let currentPath = null;
    let currentDoc = "";
    let mode = "cm6-rich";
    window.__app = {
      getCurrentDocument: () => currentPath ? { path: currentPath } : null,
      getMode: () => mode,
      loadFixtureProject: async (files, initialPath) => {
        currentPath = initialPath;
        currentDoc = files.find((file) => file.path === initialPath)?.content ?? "";
      },
      setMode: (nextMode) => {
        mode = nextMode;
      },
    };
    window.__editor = {
      getDoc: () => currentDoc,
      ready: Promise.resolve(),
    };
    window.__cmDebug = { semantics: () => ({ revision: 1 }) };
    const page = {
      evaluate: vi.fn(async (fn, arg) => fn(arg)),
      waitForFunction: vi.fn(async (fn, arg) => {
        if (arg?.selector === ".cf-doc-flow--lexical") {
          document.body.innerHTML = "<div class='cf-doc-flow--lexical'></div>";
        }
        expect(fn(arg)).toBe(true);
      }),
    };

    const opened = await openEditorScenario(page, {
      entry: "main.md",
      files: {
        "main.md": "# Scenario\n",
        "refs.bib": "@book{a,title={A}}",
      },
      mode: "lexical",
      settleMs: 0,
    });

    expect(opened).toEqual({ entry: "main.md", method: "loadFixtureProject" });
    expect(mode).toBe("lexical");
    expect(currentDoc).toBe("# Scenario\n");
  });
});

describe("browser failure artifacts", () => {
  it("writes JSON artifacts even when debug-state evaluation fails", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "coflat-browser-artifacts-test-"));
    const page = {
      evaluate: vi.fn(async () => {
        throw new Error("page evaluate failed");
      }),
      off: vi.fn(),
      on: vi.fn(),
      screenshot: vi.fn(async () => Buffer.from("")),
      url: vi.fn(() => "http://localhost:5173/"),
    };
    const recorder = createBrowserArtifactRecorder(page);

    try {
      const artifacts = await recorder.collect({
        dispose: true,
        error: new Error("scenario failed"),
        label: "unit-artifact",
        outDir,
      });

      expect(artifacts.summaryPath).toBe(join(outDir, "browser-artifacts.json"));
      expect(existsSync(artifacts.summaryPath)).toBe(true);
      expect(readFileSync(artifacts.summaryPath, "utf8")).toContain("page evaluate failed");
    } finally {
      rmSync(outDir, { force: true, recursive: true });
    }
  });

  it("treats an artifact root as a parent for timestamped captures", async () => {
    const root = mkdtempSync(join(tmpdir(), "coflat-browser-artifacts-root-test-"));
    const page = {
      evaluate: vi.fn(async () => ({})),
      off: vi.fn(),
      on: vi.fn(),
      screenshot: vi.fn(async () => Buffer.from("")),
      url: vi.fn(() => "http://localhost:5173/"),
    };
    const recorder = createBrowserArtifactRecorder(page);

    try {
      const artifacts = await recorder.collect({
        error: new Error("scenario failed"),
        label: "unit-artifact",
        root,
      });

      expect(artifacts.outDir.startsWith(`${root}/`)).toBe(true);
      expect(artifacts.summaryPath).toBe(join(artifacts.outDir, "browser-artifacts.json"));
      expect(artifacts.statePath).toBe(join(artifacts.outDir, "debug-state.json"));
      expect(existsSync(artifacts.summaryPath)).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
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
