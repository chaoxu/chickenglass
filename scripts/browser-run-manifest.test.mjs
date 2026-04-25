import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createBrowserRunManifest } from "./browser-run-manifest.mjs";

describe("browser run manifests", () => {
  it("writes one run-scoped manifest with command and result context", () => {
    const root = mkdtempSync(join(tmpdir(), "coflat-browser-run-manifest-test-"));
    const recorder = createBrowserRunManifest({
      appUrl: "http://localhost:5173",
      argv: ["--filter", "headings"],
      browserMode: "managed",
      commandRunner() {
        return { status: 0, stdout: "abc123def456\n" };
      },
      headless: true,
      label: "unit-run",
      now: new Date("2026-04-25T00:00:00.000Z"),
      root,
    });

    try {
      const written = recorder.write({
        endedAt: new Date("2026-04-25T00:00:01.250Z"),
        results: [{ name: "headings", pass: true, elapsed: 42 }],
        status: "passed",
        summary: { passed: 1, failed: 0, total: 1 },
      });

      expect(existsSync(written.manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(written.manifestPath, "utf8"));
      expect(manifest).toMatchObject({
        appUrl: "http://localhost:5173",
        argv: ["--filter", "headings"],
        browserMode: "managed",
        gitCommit: "abc123def456",
        headless: true,
        label: "unit-run",
        status: "passed",
      });
      expect(manifest.timings.wallMs).toBe(1250);
      expect(manifest.results[0]).toEqual({ name: "headings", pass: true, elapsed: 42 });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
