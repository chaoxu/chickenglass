import { describe, expect, it } from "vitest";
import {
  availableHtmlExportPandocCases,
  availableTypingBurstCases,
  buildHtmlExportPandocArgs,
  comparisonFailureRows,
  findTypingBurstPositions,
  HTML_EXPORT_PANDOC_CASES,
  HTML_EXPORT_PANDOC_REQUIRED_METRICS,
  htmlExportPandocMetrics,
  parseCliArgs,
  preflightHtmlExportPandoc,
  resolvePerfRuntimeOptions,
  scenarios,
  TYPING_BURST_CASES,
  TYPING_BURST_REQUIRED_METRICS,
  typingBurstMetrics,
} from "./perf-regression.mjs";

describe("perf regression scenarios", () => {
  it("registers html-export-pandoc as a native scenario with export metrics", () => {
    const availableCases = availableHtmlExportPandocCases().map(({ key, displayPath }) => ({
      key,
      displayPath,
    }));

    expect(scenarios["html-export-pandoc"]).toMatchObject({
      runtime: "native",
      defaultSettleMs: 0,
    });
    expect(HTML_EXPORT_PANDOC_CASES.map(({ key, displayPath }) => ({ key, displayPath }))).toEqual([
      { key: "index", displayPath: "demo/index.md" },
      { key: "cogirth_main2", displayPath: "fixtures/cogirth/main2.md" },
    ]);
    expect(availableCases).toContainEqual({ key: "index", displayPath: "demo/index.md" });
    expect(scenarios["html-export-pandoc"].requiredMetrics).toContain(
      "export.html.wall_ms.index",
    );
    expect(scenarios["html-export-pandoc"].requiredMetrics).toContain(
      "export.html.input_bytes.index",
    );
    expect(scenarios["html-export-pandoc"].requiredMetrics).toContain(
      "export.html.output_bytes.index",
    );

    if (availableCases.some(({ key }) => key === "cogirth_main2")) {
      expect(scenarios["html-export-pandoc"].requiredMetrics).toContain(
        "export.html.wall_ms.cogirth_main2",
      );
    } else {
      expect(scenarios["html-export-pandoc"].requiredMetrics).not.toContain(
        "export.html.wall_ms.cogirth_main2",
      );
    }
  });

  it("builds the HTML export Pandoc command shape used by Tauri export", () => {
    const args = buildHtmlExportPandocArgs(
      "/tmp/coflat-project",
      "/tmp/coflat-project/notes",
      "/tmp/coflat-project/exports/out.html",
    );

    expect(args).toEqual([
      "--from=markdown+fenced_divs+raw_tex+grid_tables+pipe_tables+tex_math_dollars+tex_math_single_backslash+mark",
      "--to=html5",
      "--standalone",
      "--wrap=preserve",
      "--katex",
      "--section-divs",
      "--filter=pandoc-crossref",
      "--citeproc",
      "--metadata=link-citations=true",
      `--resource-path=/tmp/coflat-project/notes${process.platform === "win32" ? ";" : ":"}/tmp/coflat-project`,
      "--output=/tmp/coflat-project/exports/out.html",
    ]);
  });

  it("emits the required HTML export Pandoc metrics", () => {
    const metrics = htmlExportPandocMetrics("index", {
      wallMs: 42,
      inputBytes: 1024,
      outputBytes: 4096,
    });

    expect(metrics).toEqual([
      { name: "export.html.wall_ms.index", unit: "ms", value: 42 },
      { name: "export.html.input_bytes.index", unit: "bytes", value: 1024 },
      { name: "export.html.output_bytes.index", unit: "bytes", value: 4096 },
    ]);
    expect(metrics.map((entry) => entry.name.split(".").slice(0, 3).join("."))).toEqual(
      HTML_EXPORT_PANDOC_REQUIRED_METRICS,
    );
  });

  it("preflights missing pandoc-crossref with a clear error", () => {
    const commandRunner = (command) => {
      if (command === "pandoc") {
        return { status: 0, stdout: "pandoc 3", stderr: "" };
      }
      return { error: new Error("ENOENT"), status: null, stderr: "" };
    };

    expect(() => preflightHtmlExportPandoc({ commandRunner })).toThrow(
      'Missing required command "pandoc-crossref" for html-export-pandoc',
    );
  });

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

  it("registers a heavy cogirth open scenario for document-analysis open work", () => {
    expect(scenarios["open-cogirth-main2"]).toMatchObject({
      defaultSettleMs: 700,
    });
    expect(scenarios["open-cogirth-main2"].description).toContain(
      "fixtures/cogirth/main2.md",
    );
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
