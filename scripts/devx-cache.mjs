import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const DEVX_CACHE_RELATIVE_DIR = ".cache/devx";
export const DEVX_CACHE_DIR = resolve(DEVX_CACHE_RELATIVE_DIR);
export const LAST_VERIFY_FILE = "last-verify.json";
export const PERF_BASELINE_FILE = "perf-baseline.json";
export const LAST_VERIFY_PATH = resolve(DEVX_CACHE_DIR, LAST_VERIFY_FILE);
export const DEFAULT_PERF_BASELINE_PATH = `${DEVX_CACHE_RELATIVE_DIR}/${PERF_BASELINE_FILE}`;
export const PERF_BASELINE_PATH = resolve(DEFAULT_PERF_BASELINE_PATH);
export const DEVX_STATUS_SCHEMA_VERSION = 1;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createVerifyStatus(payload) {
  return {
    version: DEVX_STATUS_SCHEMA_VERSION,
    ...payload,
  };
}

export function writeLastVerifyStatus(payload, path = LAST_VERIFY_PATH) {
  const status = createVerifyStatus(payload);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(status, null, 2) + "\n");
  return status;
}

export function readLastVerifyStatus(path = LAST_VERIFY_PATH) {
  if (!existsSync(path)) {
    return { kind: "missing", path };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      kind: "invalid",
      path,
    };
  }

  if (!isRecord(parsed)) {
    return { kind: "invalid", path, error: "expected a JSON object" };
  }
  if (parsed.version !== DEVX_STATUS_SCHEMA_VERSION) {
    return {
      kind: "stale",
      path,
      version: parsed.version ?? null,
    };
  }
  if (typeof parsed.ok !== "boolean" || typeof parsed.completedAt !== "string") {
    return { kind: "invalid", path, error: "missing ok/completedAt fields" };
  }

  return {
    kind: parsed.ok ? "passed" : "failed",
    path,
    status: parsed,
  };
}

export function formatLastVerifyStatus(result) {
  switch (result.kind) {
    case "missing":
      return "none";
    case "invalid":
      return `unreadable (${result.path})`;
    case "stale":
      return `stale schema (${result.path}; version ${String(result.version)})`;
    case "passed":
      return `passed at ${result.status.completedAt}`;
    case "failed":
      return `failed at ${result.status.completedAt}: ${result.status.error ?? "unknown error"}`;
    default:
      return "unknown";
  }
}

