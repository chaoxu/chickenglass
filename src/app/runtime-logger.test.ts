import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn<(command: string, args?: unknown) => Promise<void>>();
const getName = vi.fn<() => Promise<string>>();
const getVersion = vi.fn<() => Promise<string>>();
const appLogDir = vi.fn<() => Promise<string>>();

vi.mock("@tauri-apps/api/app", () => ({
  getName,
  getVersion,
}));

vi.mock("@tauri-apps/api/path", () => ({
  appLogDir,
}));

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("runtime logger", () => {
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalOnError = window.onerror;
  const originalOnUnhandledRejection = window.onunhandledrejection;

  beforeEach(() => {
    invokeMock.mockResolvedValue(undefined);
    getName.mockResolvedValue("Coflat");
    getVersion.mockResolvedValue("2.0.0");
    appLogDir.mockResolvedValue("/logs/coflat");
    (
      window as Window & {
        __TAURI_INTERNALS__?: { invoke: typeof invokeMock };
      }
    ).__TAURI_INTERNALS__ = { invoke: invokeMock };
  });

  afterEach(async () => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    window.onerror = originalOnError;
    window.onunhandledrejection = originalOnUnhandledRejection;
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const { clearRuntimeLogs } = await import("./runtime-logger");
    clearRuntimeLogs();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("forwards console.error to the desktop log plugin once per call", async () => {
    const errorSpy = vi.fn();
    const warnSpy = vi.fn();
    console.error = errorSpy;
    console.warn = warnSpy;

    const {
      getRuntimeLogsSnapshot,
      installRuntimeLogging,
    } = await import("./runtime-logger");
    await installRuntimeLogging();
    await installRuntimeLogging();

    const error = new Error("boom");
    console.error("[save] failed", { path: "notes.md" }, error);
    await flushAsyncWork();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, invokePayload] = invokeMock.mock.calls[0];
    expect(command).toBe("plugin:log|log");
    const payloadText = (invokePayload as { message: string }).message;
    const entry = JSON.parse(payloadText) as {
      source: string;
      appName: string;
      appVersion: string;
      message: string;
      stack?: string;
      details: { args: string[] };
    };
    expect(entry.source).toBe("console.error");
    expect(entry.appName).toBe("Coflat");
    expect(entry.appVersion).toBe("2.0.0");
    expect(entry.message).toBe("[save] failed");
    expect(entry.stack).toContain("boom");
    expect(entry.details.args).toContain("[save] failed");
    expect(entry.details.args).toContain('{"path":"notes.md"}');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();

    const [runtimeEntry] = getRuntimeLogsSnapshot();
    expect(runtimeEntry.source).toBe("console.error");
    expect(runtimeEntry.message).toBe("[save] failed");
    expect(runtimeEntry.stack).toContain("boom");
  });

  it("logs window.onerror and unhandled rejections with structured details", async () => {
    const { getDesktopLogDirectory, installRuntimeLogging } = await import("./runtime-logger");
    await installRuntimeLogging();

    const uncaught = new Error("uncaught");
    window.onerror?.("uncaught", "app.tsx", 10, 12, uncaught);
    window.onunhandledrejection?.({ reason: new Error("rejected") } as PromiseRejectionEvent);
    await flushAsyncWork();

    expect(invokeMock).toHaveBeenCalledTimes(2);

    const first = JSON.parse((invokeMock.mock.calls[0][1] as { message: string }).message) as {
      source: string;
      message: string;
      details: { source: string; line: number; column: number };
    };
    expect(first.source).toBe("window.onerror");
    expect(first.message).toBe("uncaught");
    expect(first.details.source).toBe("app.tsx");
    expect(first.details.line).toBe(10);
    expect(first.details.column).toBe(12);

    const second = JSON.parse((invokeMock.mock.calls[1][1] as { message: string }).message) as {
      source: string;
      message: string;
      details: { reason: string };
    };
    expect(second.source).toBe("unhandledrejection");
    expect(second.message).toBe("rejected");
    expect(second.details.reason).toBe("Error: rejected");

    await expect(getDesktopLogDirectory()).resolves.toBe("/logs/coflat");
  });

  it("captures browser runtime logs in the in-app store without Tauri", async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    const {
      getRuntimeLogsSnapshot,
      installRuntimeLogging,
    } = await import("./runtime-logger");
    await installRuntimeLogging();

    console.error("[browser] failed", new Error("dev-only"));
    await flushAsyncWork();

    expect(invokeMock).not.toHaveBeenCalled();
    const [runtimeEntry] = getRuntimeLogsSnapshot();
    expect(runtimeEntry.source).toBe("console.error");
    expect(runtimeEntry.message).toBe("[browser] failed");
    expect(runtimeEntry.stack).toContain("dev-only");
  });
});
