import { describe, expect, it } from "vitest";
import {
  availableTypingBurstCases,
  comparisonFailureRows,
  findTypingBurstPositions,
  parseCliArgs,
  resolvePerfRuntimeOptions,
  scenarios,
  TYPING_BURST_CASES,
  TYPING_BURST_REQUIRED_METRICS,
  typingBurstMetrics,
} from "./perf-regression.mjs";

describe("perf regression scenarios", () => {
  it("registers typing-rich-burst with the expected benchmark docs and required metrics", () => {
    const availableCases = availableTypingBurstCases().map(({ key, displayPath }) => ({ key, displayPath }));
    expect(scenarios["typing-rich-burst"]).toMatchObject({
      defaultSettleMs: 200,
    });
    expect(TYPING_BURST_CASES.map(({ key, displayPath }) => ({ key, displayPath }))).toEqual([
      { key: "index", displayPath: "demo/index.md" },
      { key: "rankdecrease", displayPath: "fixtures/rankdecrease/main.md" },
      { key: "cogirth_main2", displayPath: "fixtures/cogirth/main2.md" },
    ]);
    expect(availableCases).toContainEqual({ key: "index", displayPath: "demo/index.md" });
    expect(scenarios["typing-rich-burst"].requiredMetrics).toContain(
      "typing.wall_ms.index.after_frontmatter",
    );
    if (availableCases.some(({ key }) => key === "cogirth_main2")) {
      expect(scenarios["typing-rich-burst"].requiredMetrics).toContain(
        "typing.wall_ms.cogirth_main2.inline_math",
      );
      expect(scenarios["typing-rich-burst"].requiredMetrics).toContain(
        "typing.settle_ms.cogirth_main2.citation_ref",
      );
    } else {
      expect(scenarios["typing-rich-burst"].requiredMetrics).not.toContain(
        "typing.wall_ms.cogirth_main2.inline_math",
      );
    }
  });

  it("emits the required typing metrics for each document position", () => {
    const metrics = typingBurstMetrics("index", "after_frontmatter", {
      wallMs: 120,
      meanDispatchMs: 1.2,
      maxDispatchMs: 4.8,
      settleMs: 16,
      idleMs: 8,
      inputToIdleMs: 144,
    });

    expect(metrics).toEqual([
      { name: "typing.wall_ms.index.after_frontmatter", unit: "ms", value: 120 },
      { name: "typing.dispatch_mean_ms.index.after_frontmatter", unit: "ms", value: 1.2 },
      { name: "typing.dispatch_max_ms.index.after_frontmatter", unit: "ms", value: 4.8 },
      { name: "typing.settle_ms.index.after_frontmatter", unit: "ms", value: 16 },
      { name: "typing.idle_ms.index.after_frontmatter", unit: "ms", value: 8 },
      { name: "typing.input_to_idle_ms.index.after_frontmatter", unit: "ms", value: 144 },
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

  it("expands timeouts in supported heavy-doc mode", () => {
    expect(
      resolvePerfRuntimeOptions({
        getIntFlag: (_flag, fallback) => fallback,
        hasFlag: (flag) => flag === "--heavy-doc",
      }),
    ).toEqual({
      heavyDoc: true,
      debugBridgeTimeoutMs: 45000,
      fixtureOpenTimeoutMs: 45000,
      postOpenSettleMs: 800,
    });
  });

  it("honors flags passed through pnpm script separators", () => {
    const parsed = parseCliArgs([
      "capture",
      "--",
      "--scenario",
      "open-index",
      "--iterations",
      "1",
      "--warmup",
      "0",
      "--output",
      "/tmp/open-index.json",
    ]);

    expect(parsed.command).toBe("capture");
    expect(parsed.getFlag("--scenario")).toBe("open-index");
    expect(parsed.getIntFlag("--iterations", 3)).toBe(1);
    expect(parsed.getIntFlag("--warmup", 1)).toBe(0);
    expect(parsed.getFlag("--output")).toBe("/tmp/open-index.json");
  });

  it("formats missing metric comparisons as failures", () => {
    expect(comparisonFailureRows({
      frontend: [],
      backend: [],
      metrics: [
        {
          name: "typing.wall_ms.index.after_frontmatter",
          unit: "ms",
          status: "missing",
        },
      ],
    })).toEqual([
      {
        source: "metric",
        name: "typing.wall_ms.index.after_frontmatter",
        status: "missing",
        avgDeltaMs: "missing",
        avgPct: "missing",
        maxDeltaMs: "missing",
        maxPct: "missing",
      },
    ]);
  });
});
