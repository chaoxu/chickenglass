import { isTauri } from "../lib/tauri";

export type RuntimeLogSource = "console.error" | "window.onerror" | "unhandledrejection";

interface AppMetadata {
  readonly name: string | null;
  readonly version: string | null;
}

interface RuntimeLogPayload {
  readonly channel: "frontend-runtime";
  readonly source: RuntimeLogSource;
  readonly timestamp: string;
  readonly appName: string | null;
  readonly appVersion: string | null;
  readonly location: string;
  readonly userAgent: string;
  readonly message: string;
  readonly stack?: string;
  readonly errorName?: string;
  readonly details?: Record<string, unknown>;
}

export interface RuntimeLogEntry {
  readonly id: number;
  readonly source: RuntimeLogSource;
  readonly timestamp: string;
  readonly message: string;
  readonly stack?: string;
  readonly errorName?: string;
  readonly details?: Record<string, unknown>;
}

interface ConsoleMethods {
  readonly error: typeof console.error;
  readonly warn: typeof console.warn;
}

const INSTALL_WARNING_PREFIX = "[runtime-logger]";
const MAX_RUNTIME_LOG_ENTRIES = 200;
const RUNTIME_LOGGER_STATE_KEY = Symbol.for("coflat.runtime-logger.state");

interface RuntimeLoggerState {
  installPromise: Promise<void> | null;
  metadataPromise: Promise<AppMetadata> | null;
  entries: readonly RuntimeLogEntry[];
  nextEntryId: number;
  listeners: Set<() => void>;
  installedConsoleError: typeof console.error | null;
  installedOnError: OnErrorEventHandler | null;
  installedOnUnhandledRejection: Window["onunhandledrejection"];
}

function getRuntimeLoggerState(): RuntimeLoggerState {
  const host = globalThis as Record<PropertyKey, unknown>;
  const existing = host[RUNTIME_LOGGER_STATE_KEY];
  if (existing) {
    return existing as RuntimeLoggerState;
  }

  const state: RuntimeLoggerState = {
    installPromise: null,
    metadataPromise: null,
    entries: [],
    nextEntryId: 1,
    listeners: new Set(),
    installedConsoleError: null,
    installedOnError: null,
    installedOnUnhandledRejection: null,
  };
  host[RUNTIME_LOGGER_STATE_KEY] = state;
  return state;
}

function notifyRuntimeLogListeners(state: RuntimeLoggerState): void {
  for (const listener of state.listeners) {
    listener();
  }
}

export function isRuntimeLogPanelEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.MODE === "test";
}

function shouldInstallRuntimeLogging(): boolean {
  return isRuntimeLogPanelEnabled() || isTauri();
}

function appendRuntimeLog(entry: Omit<RuntimeLogEntry, "id">): void {
  if (!isRuntimeLogPanelEnabled()) return;

  const state = getRuntimeLoggerState();
  const nextEntry: RuntimeLogEntry = {
    ...entry,
    id: state.nextEntryId++,
  };
  state.entries = [nextEntry, ...state.entries].slice(0, MAX_RUNTIME_LOG_ENTRIES);
  notifyRuntimeLogListeners(state);
}

export function subscribeRuntimeLogs(callback: () => void): () => void {
  const state = getRuntimeLoggerState();
  state.listeners.add(callback);
  return () => {
    state.listeners.delete(callback);
  };
}

export function getRuntimeLogsSnapshot(): readonly RuntimeLogEntry[] {
  return getRuntimeLoggerState().entries;
}

export function clearRuntimeLogs(): void {
  const state = getRuntimeLoggerState();
  if (state.entries.length === 0) return;
  state.entries = [];
  notifyRuntimeLogListeners(state);
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(value, (_key, candidate: unknown) => {
      if (candidate instanceof Error) {
        return {
          name: candidate.name,
          message: candidate.message,
          stack: candidate.stack,
        };
      }
      if (typeof candidate === "bigint") return candidate.toString();
      if (typeof candidate === "function") {
        return `[Function ${candidate.name || "anonymous"}]`;
      }
      if (typeof candidate === "symbol") return candidate.toString();
      if (typeof candidate === "object" && candidate !== null) {
        if (seen.has(candidate)) return "[Circular]";
        seen.add(candidate);
      }
      return candidate;
    });
    return serialized ?? "undefined";
  } catch (_error) {
    return Object.prototype.toString.call(value);
  }
}

function extractErrorDetails(value: unknown): {
  readonly message: string;
  readonly errorName?: string;
  readonly stack?: string;
} | null {
  if (value instanceof Error) {
    return {
      message: value.message || value.name,
      errorName: value.name,
      stack: value.stack,
    };
  }
  if (typeof value !== "object" || value === null) return null;

  const candidate = value as {
    readonly name?: unknown;
    readonly message?: unknown;
    readonly stack?: unknown;
  };
  const message = typeof candidate.message === "string" ? candidate.message : null;
  const errorName = typeof candidate.name === "string" ? candidate.name : undefined;
  const stack = typeof candidate.stack === "string" ? candidate.stack : undefined;
  if (!message && !stack && !errorName) return null;

  return {
    message: message ?? errorName ?? safeJsonStringify(value),
    errorName,
    stack,
  };
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number"
    || typeof value === "boolean"
    || typeof value === "bigint"
    || typeof value === "symbol"
    || value == null
  ) {
    return String(value);
  }
  const errorDetails = extractErrorDetails(value);
  if (errorDetails) {
    return errorDetails.errorName
      ? `${errorDetails.errorName}: ${errorDetails.message}`
      : errorDetails.message;
  }
  return safeJsonStringify(value);
}

function createConsoleEntry(args: readonly unknown[]): {
  readonly message: string;
  readonly stack?: string;
  readonly errorName?: string;
  readonly details: Record<string, unknown>;
} {
  const serializedArgs = args.map(stringifyUnknown);
  const errorDetails = args
    .map(extractErrorDetails)
    .find((details): details is NonNullable<typeof details> => details !== null);

  return {
    message: serializedArgs[0] ?? errorDetails?.message ?? "console.error called with no arguments",
    stack: errorDetails?.stack,
    errorName: errorDetails?.errorName,
    details: {
      args: serializedArgs,
    },
  };
}

function createWindowErrorEntry(
  message: string | Event,
  source?: string,
  lineno?: number,
  colno?: number,
  error?: Error,
): {
  readonly message: string;
  readonly stack?: string;
  readonly errorName?: string;
  readonly details: Record<string, unknown>;
} {
  const errorDetails = extractErrorDetails(error);
  return {
    message: typeof message === "string" ? message : stringifyUnknown(message),
    stack: errorDetails?.stack,
    errorName: errorDetails?.errorName,
    details: {
      source: source ?? null,
      line: lineno ?? null,
      column: colno ?? null,
    },
  };
}

function createUnhandledRejectionEntry(reason: unknown): {
  readonly message: string;
  readonly stack?: string;
  readonly errorName?: string;
  readonly details: Record<string, unknown>;
} {
  const errorDetails = extractErrorDetails(reason);
  return {
    message: errorDetails?.message ?? stringifyUnknown(reason),
    stack: errorDetails?.stack,
    errorName: errorDetails?.errorName,
    details: {
      reason: stringifyUnknown(reason),
    },
  };
}

async function getAppMetadata(consoleMethods: ConsoleMethods): Promise<AppMetadata> {
  const state = getRuntimeLoggerState();
  if (!state.metadataPromise) {
    state.metadataPromise = import("@tauri-apps/api/app")
      .then(async ({ getName, getVersion }) => {
        const [name, version] = await Promise.all([getName(), getVersion()]);
        return { name, version };
      })
      .catch((error: unknown) => {
        consoleMethods.warn(`${INSTALL_WARNING_PREFIX} failed to resolve app metadata`, error);
        return { name: null, version: null };
      });
  }
  return state.metadataPromise;
}

async function logRuntimeEntry(
  consoleMethods: ConsoleMethods,
  source: RuntimeLogSource,
  entry: {
    readonly message: string;
    readonly stack?: string;
    readonly errorName?: string;
    readonly details?: Record<string, unknown>;
  },
): Promise<void> {
  const timestamp = new Date().toISOString();
  appendRuntimeLog({
    source,
    timestamp,
    message: entry.message,
    stack: entry.stack,
    errorName: entry.errorName,
    details: entry.details,
  });

  if (!isTauri()) {
    return;
  }

  try {
    const [{ error: logError }, metadata] = await Promise.all([
      import("@tauri-apps/plugin-log"),
      getAppMetadata(consoleMethods),
    ]);

    const payload: RuntimeLogPayload = {
      channel: "frontend-runtime",
      source,
      timestamp,
      appName: metadata.name,
      appVersion: metadata.version,
      location: window.location.href,
      userAgent: navigator.userAgent,
      message: entry.message,
      stack: entry.stack,
      errorName: entry.errorName,
      details: entry.details,
    };

    await logError(safeJsonStringify(payload));
  } catch (error: unknown) {
    consoleMethods.warn(`${INSTALL_WARNING_PREFIX} failed to write runtime log entry`, error);
  }
}

export async function installRuntimeLogging(): Promise<void> {
  if (!shouldInstallRuntimeLogging()) return;

  const state = getRuntimeLoggerState();
  if (state.installPromise) {
    return state.installPromise;
  }

  const consoleMethods: ConsoleMethods = {
    error: console.error.bind(console),
    warn: console.warn.bind(console),
  };

  state.installPromise = (async () => {
    if (isTauri()) {
      try {
        await import("@tauri-apps/plugin-log");
      } catch (error: unknown) {
        consoleMethods.warn(`${INSTALL_WARNING_PREFIX} failed to preload desktop logging`, error);
      }
      void getAppMetadata(consoleMethods);
    }

    const previousOnError = window.onerror;
    const nextOnError: OnErrorEventHandler = (message, source, lineno, colno, error) => {
      void logRuntimeEntry(
        consoleMethods,
        "window.onerror",
        createWindowErrorEntry(message, source, lineno, colno, error),
      );
      return previousOnError?.call(window, message, source, lineno, colno, error) ?? false;
    };
    window.onerror = nextOnError;

    const previousUnhandledRejection = window.onunhandledrejection;
    const nextUnhandledRejection: Window["onunhandledrejection"] = (event) => {
      void logRuntimeEntry(
        consoleMethods,
        "unhandledrejection",
        createUnhandledRejectionEntry(event.reason),
      );
      return previousUnhandledRejection?.call(window, event);
    };
    window.onunhandledrejection = nextUnhandledRejection;

    const nextConsoleError: typeof console.error = (...args: unknown[]) => {
      consoleMethods.error(...args);
      void logRuntimeEntry(consoleMethods, "console.error", createConsoleEntry(args));
    };
    console.error = nextConsoleError;

    state.installedConsoleError = nextConsoleError;
    state.installedOnError = nextOnError;
    state.installedOnUnhandledRejection = nextUnhandledRejection;
  })().catch((error: unknown) => {
    state.installPromise = null;
    consoleMethods.warn(`${INSTALL_WARNING_PREFIX} failed to install runtime logging`, error);
  });

  return state.installPromise;
}

export async function installDesktopRuntimeLogging(): Promise<void> {
  await installRuntimeLogging();
}

export async function getDesktopLogDirectory(): Promise<string | null> {
  if (!isTauri()) return null;
  const { appLogDir } = await import("@tauri-apps/api/path");
  return appLogDir();
}
