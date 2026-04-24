import { afterEach, describe, expect, it, vi } from "vitest";

const browserReproMocks = vi.hoisted(() => {
  let pageUrl = "http://localhost:5173/";
  const doctorState = {
    debugGlobals: {
      __app: true,
      __cfDebug: true,
      __cmView: true,
      __editor: true,
      lexicalEditor: false,
    },
    readyState: "complete",
    title: "Coflats",
    get url() {
      return pageUrl;
    },
    viteErrorOverlay: "",
  };
  const editorHealth = {
    autocompleteCount: 0,
    dialogCount: 0,
    docLength: 0,
    hoverPreviewCount: 0,
    issues: [],
    mode: "cm6-rich",
    selection: { anchor: 0, head: 0 },
    semantics: { revision: 1 },
    treeErrorNodeCount: 0,
  };
  const page = {
    context: vi.fn(() => ({ browser: () => null })),
    evaluate: vi.fn(async (_fn, args) =>
      args && Object.hasOwn(args, "maxVisibleDialogs") ? editorHealth : doctorState),
    off: vi.fn(),
    on: vi.fn(),
    reload: vi.fn(async () => {}),
    screenshot: vi.fn(async () => Buffer.from("")),
    title: vi.fn(async () => "Coflats"),
    url: vi.fn(() => pageUrl),
  };
  const stopAppServer = vi.fn(async () => {});

  return {
    page,
    stopAppServer,
    connectEditor: vi.fn(async (options = {}) => {
      pageUrl = options.url ?? "http://localhost:5173/";
      return page;
    }),
    disconnectBrowser: vi.fn(async () => {}),
    ensureAppServer: vi.fn(async () => stopAppServer),
    waitForDebugBridge: vi.fn(async () => {}),
  };
});

vi.mock("./browser-lifecycle.mjs", async () => {
  const actual = await vi.importActual("./browser-lifecycle.mjs");
  return {
    ...actual,
    connectEditor: browserReproMocks.connectEditor,
    disconnectBrowser: browserReproMocks.disconnectBrowser,
    ensureAppServer: browserReproMocks.ensureAppServer,
    waitForDebugBridge: browserReproMocks.waitForDebugBridge,
  };
});

const {
  diffSessionSummaries,
  extractReplayActions,
  openBrowserPage,
  openBrowserSession,
  parseSessionEvents,
  summarizeSessionEvents,
} = await import("./browser-repro.mjs");

describe("browser repro helpers", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("extracts replayable key and pointer actions from a session log", () => {
    const events = parseSessionEvents(`
{"type":"key","detail":{"key":"a","metaKey":false,"ctrlKey":false,"altKey":false,"shiftKey":false}}
{"type":"key","detail":{"key":"ArrowDown","metaKey":false,"ctrlKey":false,"altKey":false,"shiftKey":true}}
{"type":"pointer","detail":{"editorX":120,"editorY":48,"button":0,"metaKey":false,"ctrlKey":false,"altKey":false,"shiftKey":false}}
{"type":"key","detail":{"key":"Process","metaKey":false,"ctrlKey":false,"altKey":false,"shiftKey":false}}
`);

    expect(extractReplayActions(events)).toEqual({
      actions: [
        { type: "insertText", text: "a" },
        {
          type: "press",
          key: "ArrowDown",
          modifiers: ["Shift"],
        },
        {
          type: "click",
          editorX: 120,
          editorY: 48,
          clientX: null,
          clientY: null,
          button: 0,
          modifiers: [],
        },
      ],
      skipped: 1,
    });
  });

  it("prefers explicit snapshot events when summarizing a session", () => {
    const summary = summarizeSessionEvents([
      {
        type: "key",
        context: {
          document: { path: "index.md", name: "index.md", dirty: false },
          mode: "rich",
          selection: { anchor: 1, head: 1, from: 1, to: 1, empty: true, line: 1, col: 2 },
          render: null,
          structure: null,
          location: "http://localhost:5173/",
        },
      },
      {
        type: "snapshot",
        detail: {
          document: { path: "proof.md", name: "proof.md", dirty: true },
          mode: "source",
          selection: { anchor: 9, head: 9, from: 9, to: 9, empty: true, line: 2, col: 3 },
          structure: { kind: "frontmatter", from: 0, to: 18, title: "Proof" },
          render: { visibleRawFencedOpeners: [] },
          location: "http://localhost:5173/",
          label: "after replay",
          recorder: {
            sessionId: "sess-a",
            sessionKind: "webdriver",
            connected: true,
            queued: 0,
            captureMode: "smart",
          },
        },
      },
    ]);

    expect(summary.captureSource).toBe("snapshot");
    expect(summary.comparableCapture).toMatchObject({
      document: { path: "proof.md", name: "proof.md", dirty: true },
      mode: "source",
      selection: { head: 9, line: 2, col: 3 },
      structure: { kind: "frontmatter", to: 18 },
    });
  });

  it("clears stale structure state when a later context explicitly reports null", () => {
    const summary = summarizeSessionEvents([
      {
        type: "caret",
        context: {
          document: { path: "proof.md", name: "proof.md", dirty: false },
          mode: "rich",
          selection: { anchor: 1, head: 1, from: 1, to: 1, empty: true, line: 1, col: 2 },
          render: null,
          structure: { kind: "frontmatter", from: 0, to: 12, title: "Proof" },
          location: "http://localhost:5173/",
        },
      },
      {
        type: "focus",
        context: {
          document: { path: "proof.md", name: "proof.md", dirty: false },
          mode: "rich",
          selection: null,
          render: null,
          structure: null,
          location: "http://localhost:5173/",
        },
      },
    ]);

    expect(summary.lastContext.structure).toBeNull();
  });

  it("diffs event counts and comparable capture state across two sessions", () => {
    const left = summarizeSessionEvents([
      {
        type: "snapshot",
        detail: {
          document: { path: "index.md", name: "index.md", dirty: false },
          mode: "rich",
          selection: { anchor: 1, head: 1, from: 1, to: 1, empty: true, line: 1, col: 2 },
          structure: null,
          render: { visibleRawFencedOpeners: [] },
          location: "http://localhost:5173/",
          label: null,
          recorder: {
            sessionId: "sess-left",
            sessionKind: "human",
            connected: true,
            queued: 0,
            captureMode: "smart",
          },
        },
      },
      { type: "key" },
    ]);
    const right = summarizeSessionEvents([
      {
        type: "snapshot",
        detail: {
          document: { path: "index.md", name: "index.md", dirty: false },
          mode: "rich",
          selection: { anchor: 5, head: 5, from: 5, to: 5, empty: true, line: 1, col: 6 },
          structure: null,
          render: { visibleRawFencedOpeners: [{ line: 8, text: "::: {.proof}", classes: [] }] },
          location: "http://localhost:5173/",
          label: null,
          recorder: {
            sessionId: "sess-right",
            sessionKind: "webdriver",
            connected: false,
            queued: 2,
            captureMode: "smart",
          },
        },
      },
      { type: "key" },
      { type: "key" },
    ]);

    const diff = diffSessionSummaries(left, right);

    expect(diff.equal).toBe(false);
    expect(diff.eventCountDifferences).toEqual([
      { type: "key", left: 1, right: 2 },
    ]);
    expect(diff.captureDiff.differences.map((entry) => entry.field)).toEqual([
      "selection",
      "render",
    ]);
  });

  it("reuses the parsed timeout after reloading the CDP page", async () => {
    await openBrowserSession([
      "--browser",
      "cdp",
      "--port",
      "9333",
      "--timeout",
      "42000",
      "--url",
      "http://localhost:5174",
    ]);

    expect(browserReproMocks.ensureAppServer).toHaveBeenCalledWith(
      "http://localhost:5174",
      { autoStart: true },
    );
    expect(browserReproMocks.connectEditor).toHaveBeenCalledWith({
      browser: "cdp",
      headless: false,
      port: 9333,
      timeout: 42000,
      url: "http://localhost:5174",
    });
    expect(browserReproMocks.page.reload).toHaveBeenCalledWith({ waitUntil: "load" });
    expect(browserReproMocks.waitForDebugBridge).toHaveBeenCalledWith(
      browserReproMocks.page,
      { timeout: 42000 },
    );
  });

  it("starts the app server for the managed repro lane by default", async () => {
    const session = await openBrowserSession([]);

    expect(browserReproMocks.ensureAppServer).toHaveBeenCalledWith(
      "http://localhost:5173",
      { autoStart: true },
    );
    expect(session).toEqual({
      artifactRecorder: expect.any(Object),
      artifactsDir: undefined,
      page: browserReproMocks.page,
      stopAppServer: browserReproMocks.stopAppServer,
    });
  });

  it("honors --no-start-server for repro sessions", async () => {
    await openBrowserSession(["--no-start-server"]);

    expect(browserReproMocks.ensureAppServer).toHaveBeenCalledWith(
      "http://localhost:5173",
      { autoStart: false },
    );
  });

  it("keeps the compatibility page opener on the no-autostart path", async () => {
    await openBrowserPage([]);

    expect(browserReproMocks.ensureAppServer).toHaveBeenCalledWith(
      "http://localhost:5173",
      { autoStart: false },
    );
  });

  it("cleans up browser and server when setup fails after page creation", async () => {
    browserReproMocks.waitForDebugBridge.mockRejectedValueOnce(new Error("bridge unavailable"));

    await expect(openBrowserSession([])).rejects.toThrow("bridge unavailable");

    expect(browserReproMocks.disconnectBrowser).toHaveBeenCalledWith(browserReproMocks.page);
    expect(browserReproMocks.stopAppServer).toHaveBeenCalledTimes(1);
  });
});
