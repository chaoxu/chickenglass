import { describe, expect, it } from "vitest";
import {
  TYPING_BURST_CASES,
  TYPING_BURST_REQUIRED_METRICS,
  findTypingBurstPositions,
  scenarios,
  typingBurstMetrics,
} from "./perf-regression.mjs";

describe("perf regression scenarios", () => {
  it("registers typing-rich-burst with the expected benchmark docs", () => {
    expect(scenarios["typing-rich-burst"]).toMatchObject({
      defaultSettleMs: 200,
    });
    expect(TYPING_BURST_CASES.map(({ key, displayPath }) => ({ key, displayPath }))).toEqual([
      { key: "index", displayPath: "demo/index.md" },
      { key: "rankdecrease", displayPath: "demo/rankdecrease/main.md" },
    ]);
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

  it("picks the first prose line after frontmatter and a prose line near the end", () => {
    const positions = findTypingBurstPositions(`---
title: Demo
summary: Metadata should not be benchmarked
---

# Heading

First prose paragraph.

- list item

Final prose line.
`);

    expect(positions.after_frontmatter.line).toBe(8);
    expect(positions.near_end.line).toBe(12);
    expect(positions.after_frontmatter.anchor).toBeGreaterThan(0);
    expect(positions.near_end.anchor).toBeGreaterThan(positions.after_frontmatter.anchor);
  });
});
