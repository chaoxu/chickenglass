/**
 * Tests the eager-install contract of the debug bridge: simply importing
 * the module must populate `window.__app`, `window.__editor`, `window.__cmView`,
 * `window.__cmDebug`, and `window.__cfDebug` — callers should not need to
 * optional-chain before invoking.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorMode } from "../app/editor-mode";

describe("debug-bridge eager install", () => {
  beforeEach(() => {
    vi.resetModules();
    // Reset window surfaces so each test-re-import reinstalls fresh bindings.
    const mutableWindow = window as unknown as Record<string, unknown>;
    delete mutableWindow.__app;
    delete mutableWindow.__editor;
    delete mutableWindow.__cmView;
    delete mutableWindow.__cmDebug;
    delete mutableWindow.__cfDebug;
    delete mutableWindow.__cfSourceMap;
    delete mutableWindow.__tauriSmoke;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("installs all debug surfaces at module load", async () => {
    await import("./debug-bridge");
    expect(typeof window.__app).toBe("object");
    expect(typeof window.__app.getMode).toBe("function");
    expect(typeof window.__editor).toBe("object");
    expect(typeof window.__editor.focus).toBe("function");
    expect(typeof window.__editor.formatSelection).toBe("function");
    expect(typeof window.__cmView).toBe("object");
    expect(typeof window.__cmDebug).toBe("object");
    expect(typeof window.__cmDebug.treeString).toBe("function");
    expect(typeof window.__cfDebug).toBe("object");
    expect(typeof window.__cfDebug.perfSummary).toBe("function");
    // __cfSourceMap is an eager getter that returns null when unset.
    expect("__cfSourceMap" in window).toBe(true);
    expect(window.__cfSourceMap).toBeNull();
  });

  it("throws DebugBridgeError when methods are called before a provider connects", async () => {
    const { DebugBridgeError } = await import("./debug-bridge");
    await import("./debug-bridge");
    expect(() => window.__app.getMode()).toThrow(DebugBridgeError);
    expect(() => window.__editor.focus()).toThrow(DebugBridgeError);
  });

  it("delegates methods to a connected provider", async () => {
    const bridge = await import("./debug-bridge");
    bridge.connectAppBridge({
      openFile: vi.fn(async () => {}),
      hasFile: vi.fn(async () => true),
      openFileWithContent: vi.fn(async () => {}),
      saveFile: vi.fn(async () => {}),
      closeFile: vi.fn(async () => true),
      setSearchOpen: vi.fn(),
      setMode: vi.fn(),
      getMode: () => "source" as EditorMode,
      getProjectRoot: () => "/tmp/proj",
      getCurrentDocument: () => null,
      isDirty: () => false,
    });
    expect(window.__app.getMode()).toBe("source");
    expect(window.__app.getProjectRoot()).toBe("/tmp/proj");
    bridge.disconnectAppBridge();
    expect(() => window.__app.getMode()).toThrow(bridge.DebugBridgeError);
  });

  it("exposes a ready promise that resolves when the provider connects", async () => {
    const bridge = await import("./debug-bridge");
    expect(window.__app.ready).toBeInstanceOf(Promise);
    let settled = false;
    const readyPromise = window.__app.ready.then(() => {
      settled = true;
    });
    // Before connect, the promise must still be pending.
    await Promise.resolve();
    expect(settled).toBe(false);
    bridge.connectAppBridge({
      openFile: vi.fn(async () => {}),
      hasFile: vi.fn(async () => true),
      openFileWithContent: vi.fn(async () => {}),
      saveFile: vi.fn(async () => {}),
      closeFile: vi.fn(async () => true),
      setSearchOpen: vi.fn(),
      setMode: vi.fn(),
      getMode: () => "source" as EditorMode,
      getProjectRoot: () => "/tmp",
      getCurrentDocument: () => null,
      isDirty: () => false,
    });
    await readyPromise;
    expect(settled).toBe(true);
  });
});
