import { afterEach, describe, expect, it, vi } from "vitest";

import {
  normalizeConnectEditorOptions,
  waitForAppUrl,
} from "./test-helpers.mjs";
import { openFixtureDocument, resolveFixtureDocument } from "./test-helpers/fixtures.mjs";
import {
  DEBUG_EDITOR_SELECTOR,
  DEBUG_EDITOR_TEST_ID,
  EDITOR_MODE,
  MODE_BUTTON_SELECTOR,
  MODE_BUTTON_TEST_ID,
  MODE_LABELS,
  REVEAL_PRESENTATION,
  SETTINGS_KEY,
  WINDOW_STATE_KEY,
  WINDOW_STATE_SCOPED_PREFIX,
  isWindowStateStorageKey,
  markdownEditorModes,
  normalizeAutomationMode,
  revealPresentations,
} from "./test-helpers/shared.mjs";
import {
  DEV_SERVER_RUNTIME_ISSUE_IGNORES,
  issueMatches,
  mergeRuntimeIssueOptions,
} from "./test-helpers/runtime-issues.mjs";

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

describe("browser automation contracts", () => {
  it("shares current editor modes and normalizes the legacy read alias explicitly", () => {
    expect(markdownEditorModes).toEqual([
      EDITOR_MODE.LEXICAL,
      EDITOR_MODE.PARAGRAPH,
      EDITOR_MODE.SOURCE,
    ]);
    expect(Object.keys(MODE_LABELS).sort()).toEqual([...markdownEditorModes].sort());
    expect(normalizeAutomationMode("paragraph")).toBe(EDITOR_MODE.PARAGRAPH);
    expect(normalizeAutomationMode("read")).toBe(EDITOR_MODE.LEXICAL);
    expect(() => normalizeAutomationMode("unknown")).toThrow(/Unsupported mode/);
  });

  it("shares app-owned test ids with browser selectors", () => {
    expect(DEBUG_EDITOR_TEST_ID).toBe("lexical-editor");
    expect(DEBUG_EDITOR_SELECTOR).toBe('[data-testid="lexical-editor"]');
    expect(MODE_BUTTON_TEST_ID).toBe("mode-button");
    expect(MODE_BUTTON_SELECTOR).toBe('[data-testid="mode-button"]');
  });

  it("shares settings and window-state storage keys with reset helpers", () => {
    expect(SETTINGS_KEY).toBe("cf-settings");
    expect(WINDOW_STATE_KEY).toBe("cf-window-state");
    expect(WINDOW_STATE_SCOPED_PREFIX).toBe("cf-window-state:");
    expect(isWindowStateStorageKey("cf-window-state")).toBe(true);
    expect(isWindowStateStorageKey("cf-window-state:/tmp/project")).toBe(true);
    expect(isWindowStateStorageKey("cf-settings")).toBe(false);
  });

  it("shares reveal presentation values with automation", () => {
    expect(revealPresentations).toEqual([
      REVEAL_PRESENTATION.INLINE,
      REVEAL_PRESENTATION.FLOATING,
    ]);
  });

  it("matches runtime issue ignores by substring or regular expression", () => {
    expect(issueMatches("[vite] connected.", DEV_SERVER_RUNTIME_ISSUE_IGNORES.ignoreConsole)).toBe(true);
    expect(issueMatches("Failed to load resource: 403", [/403/])).toBe(true);
    expect(issueMatches("real regression", DEV_SERVER_RUNTIME_ISSUE_IGNORES.ignoreConsole)).toBe(false);

    const merged = mergeRuntimeIssueOptions(
      DEV_SERVER_RUNTIME_ISSUE_IGNORES,
      { ignoreConsole: [/403/] },
    );
    expect(merged.ignoreConsole).toHaveLength(3);
    expect(issueMatches("Failed to load resource: 403", merged.ignoreConsole)).toBe(true);
  });
});

describe("fixture helpers", () => {
  afterEach(() => {
    delete globalThis.window;
  });

  it("preserves resolved fixture paths when helpers receive an already-resolved fixture", () => {
    const resolved = resolveFixtureDocument({
      virtualPath: "resolved/main.md",
      displayPath: "resolved fixture",
      resolvedPath: "/tmp/coflat-fixtures/resolved/main.md",
      content: "# Resolved\n",
    });

    expect(resolved.resolvedPath).toBe("/tmp/coflat-fixtures/resolved/main.md");
  });

  it("keeps single-file fixtures isolated from an already-open project path", async () => {
    const app = {
      openFile: vi.fn(async () => {}),
      hasFile: vi.fn(async () => true),
      openFileWithContent: vi.fn(async () => {}),
      getCurrentDocument: () => ({ path: "notes.md" }),
    };
    const editor = {
      getDoc: () => "# Fixture\n",
    };
    globalThis.window = {
      __app: app,
      __editor: editor,
      __cfSourceMap: { regions: [] },
    };

    const page = {
      evaluate: vi.fn(async (callback, arg) => callback(arg)),
      waitForFunction: vi.fn(async (callback, arg) => callback(arg)),
    };

    await openFixtureDocument(page, {
      virtualPath: "notes.md",
      displayPath: "fixture:notes.md",
      content: "# Fixture\n",
    });

    expect(app.hasFile).not.toHaveBeenCalled();
    expect(app.openFile).not.toHaveBeenCalled();
    expect(app.openFileWithContent).toHaveBeenCalledWith("notes.md", "# Fixture\n");
  });

  it("loads inline public fallback projects when fixture project files are provided", async () => {
    const app = {
      openFile: vi.fn(async () => {}),
      loadFixtureProject: vi.fn(async () => {}),
      getCurrentDocument: () => ({ path: "fallback/main.md" }),
    };
    const editor = {
      getDoc: () => "# Main\n",
    };
    globalThis.window = {
      __app: app,
      __editor: editor,
      __cfSourceMap: { regions: [1] },
    };

    const page = {
      evaluate: vi.fn(async (callback, arg) => callback(arg)),
      waitForFunction: vi.fn(async (callback, arg) => callback(arg)),
    };

    await openFixtureDocument(page, {
      virtualPath: "fallback/main.md",
      displayPath: "public fallback",
      content: "# Main\n",
      projectFiles: [
        { path: "fallback/main.md", kind: "text", content: "# Main\n" },
        { path: "fallback/include.md", kind: "text", content: "# Include\n" },
      ],
    }, { project: "full-project" });

    expect(app.loadFixtureProject).toHaveBeenCalledWith([
      { path: "fallback/main.md", kind: "text", content: "# Main\n" },
      { path: "fallback/include.md", kind: "text", content: "# Include\n" },
    ], "fallback/main.md");
  });
});
