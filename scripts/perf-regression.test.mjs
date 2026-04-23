import { describe, expect, it } from "vitest";
import {
  availableHtmlExportPandocCases,
  availableTypingBurstCases,
  buildHtmlExportPandocArgs,
  comparisonFailureRows,
  finalizeLexicalBridgeObservation,
  findTypingBurstPositions,
  frontendSpanDeltaMetrics,
  HTML_EXPORT_PANDOC_CASES,
  HTML_EXPORT_PANDOC_REQUIRED_METRICS,
  htmlExportPandocMetrics,
  LEXICAL_TYPING_BURST_REQUIRED_METRICS,
  lexicalTypingBurstMetrics,
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
      insertCount: 100,
      wallMs: 120,
      wallPerCharMs: 1.2,
      meanDispatchMs: 1.2,
      p95DispatchMs: 2.8,
      maxDispatchMs: 4.8,
      settleMs: 16,
      idleMs: 8,
      inputToIdleMs: 144,
      inputToIdlePerCharMs: 1.44,
      longTaskSupported: 1,
      longTaskCount: 2,
      longTaskTotalMs: 110,
      longTaskMaxMs: 70,
      postIdleWindowMs: 500,
      postIdleLongTaskCount: 0,
      postIdleLongTaskTotalMs: 0,
      postIdleLongTaskMaxMs: 0,
      postIdleLagSamples: 20,
      postIdleLagMeanMs: 0.4,
      postIdleLagP95Ms: 1.2,
      postIdleLagMaxMs: 2.4,
    });

    expect(metrics).toEqual([
      { name: "typing.insert_count.index.after_frontmatter", unit: "count", value: 100 },
      { name: "typing.wall_ms.index.after_frontmatter", unit: "ms", value: 120 },
      { name: "typing.wall_per_char_ms.index.after_frontmatter", unit: "ms", value: 1.2 },
      { name: "typing.dispatch_mean_ms.index.after_frontmatter", unit: "ms", value: 1.2 },
      { name: "typing.dispatch_p95_ms.index.after_frontmatter", unit: "ms", value: 2.8 },
      { name: "typing.dispatch_max_ms.index.after_frontmatter", unit: "ms", value: 4.8 },
      { name: "typing.settle_ms.index.after_frontmatter", unit: "ms", value: 16 },
      { name: "typing.idle_ms.index.after_frontmatter", unit: "ms", value: 8 },
      { name: "typing.input_to_idle_ms.index.after_frontmatter", unit: "ms", value: 144 },
      { name: "typing.input_to_idle_per_char_ms.index.after_frontmatter", unit: "ms", value: 1.44 },
      { name: "typing.longtask_supported.index.after_frontmatter", unit: "count", value: 1 },
      { name: "typing.longtask_count.index.after_frontmatter", unit: "count", value: 2 },
      { name: "typing.longtask_total_ms.index.after_frontmatter", unit: "ms", value: 110 },
      { name: "typing.longtask_max_ms.index.after_frontmatter", unit: "ms", value: 70 },
      { name: "typing.post_idle_longtask_count.index.after_frontmatter", unit: "count", value: 0 },
      { name: "typing.post_idle_longtask_total_ms.index.after_frontmatter", unit: "ms", value: 0 },
      { name: "typing.post_idle_longtask_max_ms.index.after_frontmatter", unit: "ms", value: 0 },
      { name: "typing.post_idle_lag_samples.index.after_frontmatter", unit: "count", value: 20 },
      { name: "typing.post_idle_lag_mean_ms.index.after_frontmatter", unit: "ms", value: 0.4 },
      { name: "typing.post_idle_lag_p95_ms.index.after_frontmatter", unit: "ms", value: 1.2 },
      { name: "typing.post_idle_lag_max_ms.index.after_frontmatter", unit: "ms", value: 2.4 },
    ]);
    const metricPrefixes = metrics.map((entry) => entry.name.split(".").slice(0, 2).join("."));
    expect(metricPrefixes).toEqual(expect.arrayContaining(TYPING_BURST_REQUIRED_METRICS));
    expect(metrics.every((entry) => entry.value !== undefined)).toBe(true);
  });

  it("emits normalized Lexical typing metrics for burst interpretation", () => {
    const metrics = lexicalTypingBurstMetrics("index", "after_frontmatter", {
      insertCount: 100,
      wallMs: 200,
      wallPerCharMs: 2,
      meanInsertMs: 1.5,
      p95InsertMs: 3,
      maxInsertMs: 8,
      canonicalMs: 20,
      visualSyncMs: 40,
      semanticMs: 30,
      semanticWorkMs: 7,
      semanticWorkCount: 1,
      getMarkdownWorkMs: 9,
      getMarkdownWorkCount: 2,
      publishSnapshotWorkMs: 11,
      publishSnapshotWorkCount: 1,
      settleMs: 16,
      deferredSyncWorkMs: 4,
      deferredSyncCount: 1,
      incrementalSyncWorkMs: 5,
      incrementalSyncCount: 1,
      sourceSpanIndexWorkMs: 6,
      sourceSpanIndexCount: 1,
      inputToSemanticMs: 266,
      inputToSemanticPerCharMs: 2.66,
      longTaskSupported: 1,
      longTaskCount: 3,
      longTaskTotalMs: 190,
      longTaskMaxMs: 90,
      postIdleWindowMs: 500,
      postIdleLongTaskCount: 1,
      postIdleLongTaskTotalMs: 60,
      postIdleLongTaskMaxMs: 60,
      postIdleLagSamples: 20,
      postIdleLagMeanMs: 0.5,
      postIdleLagP95Ms: 1.4,
      postIdleLagMaxMs: 3,
    });

    expect(metrics).toEqual([
      { name: "lexical.typing.insert_count.index.after_frontmatter", unit: "count", value: 100 },
      { name: "lexical.typing.wall_ms.index.after_frontmatter", unit: "ms", value: 200 },
      { name: "lexical.typing.wall_per_char_ms.index.after_frontmatter", unit: "ms", value: 2 },
      { name: "lexical.typing.insert_mean_ms.index.after_frontmatter", unit: "ms", value: 1.5 },
      { name: "lexical.typing.insert_p95_ms.index.after_frontmatter", unit: "ms", value: 3 },
      { name: "lexical.typing.insert_max_ms.index.after_frontmatter", unit: "ms", value: 8 },
      { name: "lexical.typing.canonical_ms.index.after_frontmatter", unit: "ms", value: 20 },
      { name: "lexical.typing.visual_sync_ms.index.after_frontmatter", unit: "ms", value: 40 },
      { name: "lexical.typing.semantic_ms.index.after_frontmatter", unit: "ms", value: 30 },
      { name: "lexical.typing.semantic_work_ms.index.after_frontmatter", unit: "ms", value: 7 },
      { name: "lexical.typing.semantic_work_count.index.after_frontmatter", unit: "count", value: 1 },
      { name: "lexical.typing.get_markdown_work_ms.index.after_frontmatter", unit: "ms", value: 9 },
      { name: "lexical.typing.get_markdown_work_count.index.after_frontmatter", unit: "count", value: 2 },
      { name: "lexical.typing.publish_snapshot_work_ms.index.after_frontmatter", unit: "ms", value: 11 },
      { name: "lexical.typing.publish_snapshot_work_count.index.after_frontmatter", unit: "count", value: 1 },
      { name: "lexical.typing.deferred_sync_work_ms.index.after_frontmatter", unit: "ms", value: 4 },
      { name: "lexical.typing.deferred_sync_count.index.after_frontmatter", unit: "count", value: 1 },
      { name: "lexical.typing.incremental_sync_work_ms.index.after_frontmatter", unit: "ms", value: 5 },
      { name: "lexical.typing.incremental_sync_count.index.after_frontmatter", unit: "count", value: 1 },
      { name: "lexical.typing.source_span_index_work_ms.index.after_frontmatter", unit: "ms", value: 6 },
      { name: "lexical.typing.source_span_index_count.index.after_frontmatter", unit: "count", value: 1 },
      { name: "lexical.typing.input_to_semantic_ms.index.after_frontmatter", unit: "ms", value: 266 },
      { name: "lexical.typing.input_to_semantic_per_char_ms.index.after_frontmatter", unit: "ms", value: 2.66 },
      { name: "lexical.typing.longtask_supported.index.after_frontmatter", unit: "count", value: 1 },
      { name: "lexical.typing.longtask_count.index.after_frontmatter", unit: "count", value: 3 },
      { name: "lexical.typing.longtask_total_ms.index.after_frontmatter", unit: "ms", value: 190 },
      { name: "lexical.typing.longtask_max_ms.index.after_frontmatter", unit: "ms", value: 90 },
      { name: "lexical.typing.post_idle_longtask_count.index.after_frontmatter", unit: "count", value: 1 },
      { name: "lexical.typing.post_idle_longtask_total_ms.index.after_frontmatter", unit: "ms", value: 60 },
      { name: "lexical.typing.post_idle_longtask_max_ms.index.after_frontmatter", unit: "ms", value: 60 },
      { name: "lexical.typing.post_idle_lag_samples.index.after_frontmatter", unit: "count", value: 20 },
      { name: "lexical.typing.post_idle_lag_mean_ms.index.after_frontmatter", unit: "ms", value: 0.5 },
      { name: "lexical.typing.post_idle_lag_p95_ms.index.after_frontmatter", unit: "ms", value: 1.4 },
      { name: "lexical.typing.post_idle_lag_max_ms.index.after_frontmatter", unit: "ms", value: 3 },
    ]);
    const metricPrefixes = metrics.map((entry) => entry.name.split(".").slice(0, 3).join("."));
    expect(metricPrefixes).toEqual(expect.arrayContaining(LEXICAL_TYPING_BURST_REQUIRED_METRICS));
    expect(metrics.every((entry) => entry.value !== undefined)).toBe(true);
  });

  it("keeps visual sync metrics present when a bridge insert stays sync-free", () => {
    const metrics = lexicalTypingBurstMetrics("index", "near_end", {
      insertCount: 100,
      wallMs: 180,
      wallPerCharMs: 1.8,
      meanInsertMs: 1.4,
      p95InsertMs: 2.9,
      maxInsertMs: 7,
      canonicalMs: 0,
      visualSyncMs: 0,
      semanticMs: 24,
      semanticWorkMs: 6,
      semanticWorkCount: 1,
      getMarkdownWorkMs: 8,
      getMarkdownWorkCount: 2,
      publishSnapshotWorkMs: 10,
      publishSnapshotWorkCount: 1,
      settleMs: 16,
      deferredSyncWorkMs: 0,
      deferredSyncCount: 0,
      incrementalSyncWorkMs: 0,
      incrementalSyncCount: 0,
      sourceSpanIndexWorkMs: 5,
      sourceSpanIndexCount: 1,
      inputToSemanticMs: 220,
      inputToSemanticPerCharMs: 2.2,
      longTaskSupported: 1,
      longTaskCount: 0,
      longTaskTotalMs: 0,
      longTaskMaxMs: 0,
      postIdleWindowMs: 500,
      postIdleLongTaskCount: 0,
      postIdleLongTaskTotalMs: 0,
      postIdleLongTaskMaxMs: 0,
      postIdleLagSamples: 12,
      postIdleLagMeanMs: 0.3,
      postIdleLagP95Ms: 0.8,
      postIdleLagMaxMs: 1.1,
    });

    expect(metrics).toEqual(expect.arrayContaining([
      { name: "lexical.typing.visual_sync_ms.index.near_end", unit: "ms", value: 0 },
      { name: "lexical.typing.deferred_sync_count.index.near_end", unit: "count", value: 0 },
      { name: "lexical.typing.incremental_sync_count.index.near_end", unit: "count", value: 0 },
    ]));
  });

  it("computes input_to_semantic from the slower of canonical and semantic completion", () => {
    expect(finalizeLexicalBridgeObservation({
      insertCount: 100,
      wallMs: 180,
      canonicalMs: 40,
      visualSyncMs: 18,
      visualSyncObserved: true,
      semanticMs: 320,
      settleMs: 16,
    })).toMatchObject({
      visualSyncMs: 18,
      inputToSemanticMs: 516,
      inputToSemanticPerCharMs: 5.16,
    });

    expect(finalizeLexicalBridgeObservation({
      insertCount: 100,
      wallMs: 180,
      canonicalMs: 280,
      visualSyncMs: 14,
      visualSyncObserved: false,
      semanticMs: 120,
      settleMs: 16,
    })).toMatchObject({
      visualSyncMs: 0,
      inputToSemanticMs: 476,
      inputToSemanticPerCharMs: 4.76,
    });
  });

  it("emits position-scoped frontend span deltas for typing attribution", () => {
    const metrics = frontendSpanDeltaMetrics(
      "typing",
      "index",
      "after_frontmatter",
      [
        { name: "cm6.documentAnalysis.update", count: 4, totalMs: 10 },
        { name: "cm6.markdownRender.incrementalDoc", count: 1, totalMs: 2 },
      ],
      [
        { name: "cm6.documentAnalysis.update", count: 9, totalMs: 18.5 },
        { name: "cm6.markdownRender.incrementalDoc", count: 1, totalMs: 2 },
        { name: "cm6.referenceRender.map", count: 2, totalMs: 1.25 },
      ],
    );

    expect(metrics).toEqual([
      {
        name: "typing.span_count.cm6.documentAnalysis.update.index.after_frontmatter",
        unit: "count",
        value: 5,
      },
      {
        name: "typing.span_count.cm6.referenceRender.map.index.after_frontmatter",
        unit: "count",
        value: 2,
      },
      {
        name: "typing.span_total_ms.cm6.documentAnalysis.update.index.after_frontmatter",
        unit: "ms",
        value: 8.5,
      },
      {
        name: "typing.span_total_ms.cm6.referenceRender.map.index.after_frontmatter",
        unit: "ms",
        value: 1.25,
      },
    ]);
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
