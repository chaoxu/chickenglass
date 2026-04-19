import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEVX_CACHE_RELATIVE_DIR,
  DEVX_STATUS_SCHEMA_VERSION,
  DEFAULT_PERF_BASELINE_PATH,
  formatLastVerifyStatus,
  readLastVerifyStatus,
  writeLastVerifyStatus,
} from "./devx-cache.mjs";

const cleanup = [];

afterEach(() => {
  while (cleanup.length > 0) {
    rmSync(cleanup.pop(), { recursive: true, force: true });
  }
});

function tempPath(name) {
  const root = mkdtempSync(join(tmpdir(), "coflat-devx-cache-"));
  cleanup.push(root);
  return join(root, name);
}

describe("devx cache", () => {
  it("declares shared cache paths once", () => {
    expect(DEVX_CACHE_RELATIVE_DIR).toBe(".cache/devx");
    expect(DEFAULT_PERF_BASELINE_PATH).toBe(".cache/devx/perf-baseline.json");
  });

  it("reports missing verify status", () => {
    const result = readLastVerifyStatus(tempPath("missing.json"));

    expect(result.kind).toBe("missing");
    expect(formatLastVerifyStatus(result)).toBe("none");
  });

  it("writes and reads passed verify status with a schema version", () => {
    const path = tempPath("last-verify.json");
    writeLastVerifyStatus({
      completedAt: "2026-04-20T00:00:00.000Z",
      durationMs: 25,
      ok: true,
      steps: [],
    }, path);

    const result = readLastVerifyStatus(path);
    expect(result.kind).toBe("passed");
    expect(result.status.version).toBe(DEVX_STATUS_SCHEMA_VERSION);
    expect(formatLastVerifyStatus(result)).toBe("passed at 2026-04-20T00:00:00.000Z");
  });

  it("normalizes failed, invalid, and stale verify status files", () => {
    const failedPath = tempPath("failed.json");
    writeLastVerifyStatus({
      completedAt: "2026-04-20T00:00:00.000Z",
      durationMs: 25,
      error: "lint failed",
      ok: false,
      steps: [],
    }, failedPath);
    expect(formatLastVerifyStatus(readLastVerifyStatus(failedPath))).toContain("lint failed");

    const invalidPath = tempPath("invalid.json");
    writeFileSync(invalidPath, "not json");
    expect(readLastVerifyStatus(invalidPath).kind).toBe("invalid");

    const stalePath = tempPath("stale.json");
    writeFileSync(stalePath, JSON.stringify({ version: 0, ok: true, completedAt: "x" }));
    expect(readLastVerifyStatus(stalePath)).toMatchObject({ kind: "stale", version: 0 });
  });
});

