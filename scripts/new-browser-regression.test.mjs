import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createBrowserRegression } from "./new-browser-regression.mjs";

const cleanup = [];

afterEach(() => {
  while (cleanup.length > 0) {
    rmSync(cleanup.pop(), { recursive: true, force: true });
  }
});

describe("new-browser-regression", () => {
  it("creates a sanitized regression file from the selected template", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "coflat-browser-regression-"));
    cleanup.push(repoRoot);

    const outputPath = await createBrowserRegression({
      name: " Inline Math Keyboard ",
      repoRoot,
    });

    expect(outputPath.endsWith("scripts/regression-tests/inline-math-keyboard.mjs")).toBe(true);
    const source = readFileSync(outputPath, "utf8");
    expect(source).toContain('export const name = "inline-math-keyboard";');
    expect(source).toContain("withRuntimeIssueCapture");
  });
});
