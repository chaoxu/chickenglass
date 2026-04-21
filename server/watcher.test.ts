// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted lets us define values that are available inside vi.mock factories
const { mockWatcher, MockWebSocketServer } = vi.hoisted(() => {
  // biome-ignore lint/style/noCommonJs: vi.hoisted requires synchronous import; dynamic import() is not allowed here
  const { EventEmitter: EE } = require("node:events") as typeof import("node:events");

  const watcher = Object.assign(new EE(), {
    close: vi.fn().mockResolvedValue(undefined),
  });

  class MockWSS extends EE {
    clients = new Set<{ readyState: number; send: ReturnType<typeof vi.fn> }>();
    close = vi.fn();
  }

  return { mockWatcher: watcher, MockWebSocketServer: MockWSS };
});

vi.mock("chokidar", () => ({
  watch: vi.fn(() => mockWatcher),
}));

vi.mock("ws", () => ({
  WebSocketServer: MockWebSocketServer,
}));

import { watch } from "chokidar";
import { FileWatcher } from "./watcher.js";

describe("FileWatcher with chokidar", () => {
  let fakeServer: { on: ReturnType<typeof vi.fn> };
  let fileWatcher: FileWatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeServer = { on: vi.fn() };
    fileWatcher = new FileWatcher(fakeServer as never, "/project");
    fileWatcher.start();
  });

  afterEach(() => {
    fileWatcher.stop();
    vi.useRealTimers();
    mockWatcher.removeAllListeners();
    vi.clearAllMocks();
  });

  it("creates a chokidar watcher with ignoreInitial and ignored option", () => {
    expect(watch).toHaveBeenCalledWith("/project", {
      ignoreInitial: true,
      ignored: expect.any(Function),
    });
  });

  it("maps chokidar 'add' events to FileChangeEvent type 'add'", () => {
    const wss = (fileWatcher as unknown as { wss: InstanceType<typeof MockWebSocketServer> }).wss;
    const client = { readyState: 1, send: vi.fn() };
    wss.clients.add(client);

    mockWatcher.emit("add", "/project/notes/new.md");
    vi.advanceTimersByTime(100);

    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "add", path: "notes/new.md" }),
    );
  });

  it("maps chokidar 'change' events to FileChangeEvent type 'change'", () => {
    const wss = (fileWatcher as unknown as { wss: InstanceType<typeof MockWebSocketServer> }).wss;
    const client = { readyState: 1, send: vi.fn() };
    wss.clients.add(client);

    mockWatcher.emit("change", "/project/notes/index.md");
    vi.advanceTimersByTime(100);

    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "change", path: "notes/index.md" }),
    );
  });

  it("maps chokidar 'unlink' events to FileChangeEvent type 'delete'", () => {
    const wss = (fileWatcher as unknown as { wss: InstanceType<typeof MockWebSocketServer> }).wss;
    const client = { readyState: 1, send: vi.fn() };
    wss.clients.add(client);

    mockWatcher.emit("unlink", "/project/notes/old.md");
    vi.advanceTimersByTime(100);

    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "delete", path: "notes/old.md" }),
    );
  });

  it("debounces rapid events on the same path", () => {
    const wss = (fileWatcher as unknown as { wss: InstanceType<typeof MockWebSocketServer> }).wss;
    const client = { readyState: 1, send: vi.fn() };
    wss.clients.add(client);

    mockWatcher.emit("change", "/project/notes/index.md");
    vi.advanceTimersByTime(50);
    mockWatcher.emit("change", "/project/notes/index.md");
    vi.advanceTimersByTime(100);

    // Only the second event should be delivered (debounced)
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it("ignores dotfiles, node_modules, and dist via the ignored option", () => {
    const watchCall = vi.mocked(watch).mock.calls[0];
    const ignoredFn = watchCall[1]?.ignored as (path: string) => boolean;

    // Root dir itself is not ignored
    expect(ignoredFn("/project")).toBe(false);
    // Dotfiles/dirs ignored
    expect(ignoredFn("/project/.git")).toBe(true);
    expect(ignoredFn("/project/.git/config")).toBe(true);
    // node_modules ignored
    expect(ignoredFn("/project/node_modules")).toBe(true);
    expect(ignoredFn("/project/node_modules/foo/index.js")).toBe(true);
    // dist ignored
    expect(ignoredFn("/project/dist")).toBe(true);
    // Normal files not ignored
    expect(ignoredFn("/project/notes/index.md")).toBe(false);
    expect(ignoredFn("/project/src/main.ts")).toBe(false);
  });

  it("closes chokidar watcher on stop", () => {
    fileWatcher.stop();
    expect(mockWatcher.close).toHaveBeenCalled();
  });
});
