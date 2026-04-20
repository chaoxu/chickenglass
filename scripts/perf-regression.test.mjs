import { describe, expect, it } from "vitest";
import {
  availableTypingBurstCases,
  TYPING_BURST_INSERT_COUNT,
  TYPING_BURST_CASES,
  TYPING_BURST_REQUIRED_METRICS,
  findTypingBurstPositions,
  resolvePerfServerPlan,
  scenarios,
  typingBurstMetrics,
  unavailableTypingBurstCases,
} from "./perf-regression.mjs";

describe("perf regression scenarios", () => {
  it("owns the dev-server by default and preserves explicit opt-out lanes", () => {
    expect(resolvePerfServerPlan({
      chromeUrl: "http://localhost:5173",
      explicitUrl: undefined,
      noServer: false,
    })).toEqual({
      ownServer: true,
      url: undefined,
    });
    expect(resolvePerfServerPlan({
      chromeUrl: "http://localhost:5173",
      explicitUrl: "http://localhost:5178",
      noServer: false,
    })).toEqual({
      ownServer: true,
      url: "http://localhost:5178",
    });
    expect(resolvePerfServerPlan({
      chromeUrl: "http://localhost:5173",
      explicitUrl: undefined,
      noServer: true,
    })).toEqual({
      ownServer: false,
      url: "http://localhost:5173",
    });
  });

  it("registers typing-lexical-burst with the expected benchmark docs and required metrics", () => {
    const availableCases = availableTypingBurstCases().map(({ key, displayPath }) => ({ key, displayPath }));
    expect(scenarios["typing-lexical-burst"]).toMatchObject({
      defaultSettleMs: 200,
    });
    expect(TYPING_BURST_INSERT_COUNT).toBe(100);
    expect(TYPING_BURST_CASES.map(({ key, displayPath }) => ({ key, displayPath }))).toEqual([
      { key: "index", displayPath: "demo/index.md" },
      { key: "public_heavy", displayPath: "demo/perf-heavy/main.md" },
    ]);
    expect(availableCases).toContainEqual({ key: "index", displayPath: "demo/index.md" });
    expect(availableCases).toContainEqual({ key: "public_heavy", displayPath: "demo/perf-heavy/main.md" });
    expect(scenarios["typing-lexical-burst"].requiredMetrics).toContain(
      "typing.wall_ms.index.after_frontmatter",
    );
    expect(scenarios["typing-lexical-burst"].requiredMetrics).toContain(
      "typing.wall_ms.public_heavy.inline_math",
    );
    expect(scenarios["typing-lexical-burst"].requiredMetrics).toContain(
      "typing.settle_ms.public_heavy.citation_ref",
    );
  });

  it("reports unavailable typing fixtures instead of shrinking required metrics", () => {
    const missingCases = unavailableTypingBurstCases([
      {
        key: "missing_private",
        displayPath: "fixtures/private/missing.md",
        virtualPath: "private/missing.md",
        candidates: ["/tmp/coflat-missing-fixture.md"],
      },
    ]);

    expect(missingCases.map(({ key }) => key)).toEqual(["missing_private"]);
    expect(scenarios["typing-lexical-burst"].requiredMetrics).toContain(
      "typing.wall_ms.public_heavy.after_frontmatter",
    );
  });

  it("emits the required typing metrics for each document position", () => {
    const metrics = typingBurstMetrics("index", "after_frontmatter", {
      wallMs: 120,
      meanDispatchMs: 1.2,
      maxDispatchMs: 4.8,
      settleMs: 16,
    });

    expect(metrics).toEqual([
      { name: "typing.wall_ms.index.after_frontmatter", unit: "ms", value: 120 },
      { name: "typing.dispatch_mean_ms.index.after_frontmatter", unit: "ms", value: 1.2 },
      { name: "typing.dispatch_max_ms.index.after_frontmatter", unit: "ms", value: 4.8 },
      { name: "typing.settle_ms.index.after_frontmatter", unit: "ms", value: 16 },
    ]);
    expect(metrics.map((entry) => entry.name.split(".").slice(0, 2).join("."))).toEqual(
      TYPING_BURST_REQUIRED_METRICS,
    );
  });

  it("picks prose and semantic hotspot typing positions deterministically", () => {
    const positions = findTypingBurstPositions(`---
title: Demo
summary: Metadata should not be benchmarked
---

# Heading

First prose paragraph.

Equation line with $x^2$ inline math.

See [@thm:sample] for the theorem.

Final prose line.
`, ["after_frontmatter", "inline_math", "citation_ref", "near_end"]);

    expect(positions.after_frontmatter.line).toBe(8);
    expect(positions.inline_math.line).toBe(10);
    expect(positions.citation_ref.line).toBe(12);
    expect(positions.near_end.line).toBe(14);
    expect(positions.after_frontmatter.anchor).toBeGreaterThan(0);
    expect(positions.inline_math.anchor).toBeGreaterThan(positions.after_frontmatter.anchor);
    expect(positions.citation_ref.anchor).toBeGreaterThan(positions.inline_math.anchor);
    expect(positions.near_end.anchor).toBeGreaterThan(positions.citation_ref.anchor);
  });

  it("fails fast when a requested semantic hotspot is missing", () => {
    expect(() => findTypingBurstPositions("Plain prose only.\n", ["inline_math"])).toThrow(
      "Failed to find inline_math typing benchmark position.",
    );
  });
});
