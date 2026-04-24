import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildFixtureProjectPayload,
  COGIRTH_MAIN2_FIXTURE,
  DEFAULT_FIXTURE_OPEN_TIMEOUT_MS,
  DEFAULT_FIXTURE_SETTLE_MS,
  isMissingFixtureError,
  MissingFixtureError,
  PUBLIC_SHOWCASE_FIXTURE,
  RANKDECREASE_MAIN_FIXTURE,
  resolveFixtureDocument,
  resolveFixtureDocumentWithFallback,
} from "./fixture-test-helpers.mjs";
import { DEFAULT_RUNTIME_BUDGET_PROFILE } from "./runtime-budget-profiles.mjs";

describe("fixture registry", () => {
  it("derives fixture automation budgets from the default runtime profile", () => {
    expect(DEFAULT_FIXTURE_OPEN_TIMEOUT_MS).toBe(
      DEFAULT_RUNTIME_BUDGET_PROFILE.fixtureOpenTimeoutMs,
    );
    expect(DEFAULT_FIXTURE_SETTLE_MS).toBe(
      DEFAULT_RUNTIME_BUDGET_PROFILE.postOpenSettleMs,
    );
  });

  it("owns shared public and heavy fixture definitions", () => {
    expect(PUBLIC_SHOWCASE_FIXTURE).toMatchObject({
      key: "index",
      displayPath: "demo/index.md",
      virtualPath: "index.md",
    });
    expect(RANKDECREASE_MAIN_FIXTURE).toMatchObject({
      key: "rankdecrease",
      displayPath: "fixtures/rankdecrease/main.md",
      virtualPath: "rankdecrease/main.md",
      defaultLine: 900,
    });
    expect(COGIRTH_MAIN2_FIXTURE).toMatchObject({
      key: "cogirth_main2",
      displayPath: "fixtures/cogirth/main2.md",
      virtualPath: "cogirth/main2.md",
      defaultLine: 700,
    });
  });

  it("resolves fallback fixture definitions to the public showcase", () => {
    const resolved = resolveFixtureDocumentWithFallback({
      displayPath: "fixtures/missing/private.md",
      virtualPath: "missing/private.md",
      candidates: [resolve("/tmp/coflat-missing-private.md")],
    });

    expect(resolved.displayPath).toBe("demo/index.md");
    expect(resolved.virtualPath).toBe("index.md");
    expect(resolved.content.length).toBeGreaterThan(0);
  });

  it("throws a typed error for missing required fixtures", () => {
    expect(() => resolveFixtureDocument({
      displayPath: "fixtures/missing/private.md",
      virtualPath: "missing/private.md",
      candidates: [resolve("/tmp/coflat-missing-private.md")],
    })).toThrow(MissingFixtureError);

    try {
      resolveFixtureDocument({
        displayPath: "fixtures/missing/private.md",
        virtualPath: "missing/private.md",
        candidates: [resolve("/tmp/coflat-missing-private.md")],
      });
    } catch (error) {
      expect(isMissingFixtureError(error)).toBe(true);
    }
  });

  it("builds full-project payloads relative to the owning fixture root", () => {
    const root = mkdtempSync(join(tmpdir(), "coflat-fixture-registry-"));
    try {
      const project = join(root, "paper");
      mkdirSync(join(project, "assets"), { recursive: true });
      writeFileSync(join(project, "main.md"), "# Main\n");
      writeFileSync(join(project, "assets", "diagram.svg"), "<svg />\n");

      const payload = buildFixtureProjectPayload(
        "paper/main.md",
        join(root, "paper", "main.md"),
      );

      expect(payload?.files).toEqual(expect.arrayContaining([
        { path: "paper/main.md", kind: "text", content: "# Main\n" },
        { path: "paper/assets/diagram.svg", kind: "text", content: "<svg />\n" },
      ]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rebuilds project payloads when fixture content changes", () => {
    const root = mkdtempSync(join(tmpdir(), "coflat-fixture-registry-"));
    try {
      const project = join(root, "paper");
      mkdirSync(project, { recursive: true });
      const mainPath = join(project, "main.md");
      writeFileSync(mainPath, "# First\n");

      const first = buildFixtureProjectPayload("paper/main.md", mainPath);
      writeFileSync(mainPath, "# Second\n");
      const second = buildFixtureProjectPayload("paper/main.md", mainPath);

      expect(first?.files).toContainEqual({
        path: "paper/main.md",
        kind: "text",
        content: "# First\n",
      });
      expect(second?.files).toContainEqual({
        path: "paper/main.md",
        kind: "text",
        content: "# Second\n",
      });
      expect(second?.key).not.toBe(first?.key);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves generated fixture content without a filesystem root", () => {
    const resolved = resolveFixtureDocument({
      displayPath: "generated:inline.md",
      virtualPath: "inline.md",
      content: "# Generated\n",
    });

    expect(resolved).toMatchObject({
      displayPath: "generated:inline.md",
      virtualPath: "inline.md",
      resolvedPath: null,
      content: "# Generated\n",
    });
  });
});
