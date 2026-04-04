import { isTauri } from "../lib/tauri";

type RuntimeLogSource = "console.error" | "window.onerror" | "unhandledrejection";

interface AppMetadata {
  readonly name: string | null;
  readonly version: string | null;
}

interface RuntimeLogEntry {
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

interface ConsoleMethods {
  readonly error: typeof console.error;
  readonly warn: typeof console.warn;
}

const INSTALL_WARNING_PREFIX = "[runtime-logger]";

let installPromise: Promise<void> | null = null;
let metadataPromise: Promise<AppMetadata> | null = null;

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
  } catch {
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
  if (!metadataPromise) {
    metadataPromise = import("@tauri-apps/api/app")
      .then(async ({ getName, getVersion }) => {
        const [name, version] = await Promise.all([getName(), getVersion()]);
        return { name, version };
      })
      .catch((error: unknown) => {
        consoleMethods.warn(`${INSTALL_WARNING_PREFIX} failed to resolve app metadata`, error);
        return { name: null, version: null };
      });
  }
  return metadataPromise;
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
  try {
    const [{ error: logError }, metadata] = await Promise.all([
      import("@tauri-apps/plugin-log"),
      getAppMetadata(consoleMethods),
    ]);

    const payload: RuntimeLogEntry = {
      channel: "frontend-runtime",
      source,
      timestamp: new Date().toISOString(),
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

export async function installDesktopRuntimeLogging(): Promise<void> {
  if (!isTauri()) return;
  if (installPromise) return installPromise;

  const consoleMethods: ConsoleMethods = {
    error: console.error.bind(console),
    warn: console.warn.bind(console),
  };

  installPromise = (async () => {
    await import("@tauri-apps/plugin-log");
    void getAppMetadata(consoleMethods);

    const previousOnError = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
      void logRuntimeEntry(
        consoleMethods,
        "window.onerror",
        createWindowErrorEntry(message, source, lineno, colno, error),
      );
      return previousOnError?.call(window, message, source, lineno, colno, error) ?? false;
    };

    const previousUnhandledRejection = window.onunhandledrejection;
    window.onunhandledrejection = (event) => {
      void logRuntimeEntry(
        consoleMethods,
        "unhandledrejection",
        createUnhandledRejectionEntry(event.reason),
      );
      return previousUnhandledRejection?.call(window, event);
    };

    console.error = (...args: unknown[]) => {
      consoleMethods.error(...args);
      void logRuntimeEntry(consoleMethods, "console.error", createConsoleEntry(args));
    };
  })().catch((error: unknown) => {
    installPromise = null;
    consoleMethods.warn(`${INSTALL_WARNING_PREFIX} failed to install desktop runtime logging`, error);
  });

  return installPromise;
}

export async function getDesktopLogDirectory(): Promise<string | null> {
  if (!isTauri()) return null;
  const { appLogDir } = await import("@tauri-apps/api/path");
  return appLogDir();
}
