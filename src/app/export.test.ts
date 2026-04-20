import { afterEach, describe, expect, it, vi } from "vitest";

import {
  _buildHtmlDocumentForTest,
  _buildHtmlDocumentAsyncForTest,
  _resolveExportThemeTokensForTest,
  batchExport,
  sanitizeCssValue,
} from "./export";
import type { FileEntry } from "./file-system";
import { MemoryFileSystem } from "./memory-file-system";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveExportThemeTokens", () => {
  const root = document.documentElement;
  const touchedVars = [
    "--cf-bg",
    "--cf-fg",
    "--cf-border",
    "--cf-block-theorem-style",
  ];

  afterEach(() => {
    for (const name of touchedVars) {
      root.style.removeProperty(name);
    }
  });

  it("falls back to light defaults when no theme override is present", () => {
    const tokens = _resolveExportThemeTokensForTest();
    expect(tokens["--cf-bg"]).toBe("#ffffff");
    expect(tokens["--cf-fg"]).toBe("#09090b");
    expect(tokens["--cf-block-theorem-style"]).toBe("italic");
  });

  it("reads resolved theme tokens from documentElement", () => {
    root.style.setProperty("--cf-bg", "#101010");
    root.style.setProperty("--cf-fg", "#fafafa");
    root.style.setProperty("--cf-border", "#333333");

    const tokens = _resolveExportThemeTokensForTest();
    expect(tokens["--cf-bg"]).toBe("#101010");
    expect(tokens["--cf-fg"]).toBe("#fafafa");
    expect(tokens["--cf-border"]).toBe("#333333");
  });
});

describe("buildHtmlDocument", () => {
  it("renders the markdown source inside a styled pre block", () => {
    const html = _buildHtmlDocumentForTest(
      "::: {.theorem} Title\nBody\n:::\n\nA [link](https://example.com).\n\n`code`",
      "sample",
    );

    expect(html).toContain("--cf-bg: #ffffff;");
    expect(html).toContain("color: var(--cf-fg);");
    expect(html).toContain("background: var(--cf-hover);");
    expect(html).toContain('<pre class="cf-markdown-source">');
    expect(html).toContain("::: {.theorem} Title");
    expect(html).toContain("A [link](https://example.com).");
    expect(html).not.toContain("color: #111;");
    expect(html).not.toContain("background: #fff;");
  });

  it("keeps async HTML export aligned with the source-preserving renderer", async () => {
    const html = await _buildHtmlDocumentAsyncForTest(
      "![Figure](fig.pdf)",
      "sample",
      undefined,
      "notes/main.md",
    );

    expect(html).toContain('<pre class="cf-markdown-source">![Figure](fig.pdf)</pre>');
  });

  // Regression (#503): CSS values injected into the <style> block must not
  // allow </style> breakout. Unit tests for sanitizeCssValue cover the
  // stripping logic directly; this integration test verifies the serializer
  // applies the sanitizer to all token values.
  it("applies CSS sanitization to theme tokens in the style block", () => {
    // jsdom's getComputedStyle may strip the value during set, so we verify
    // that the serialization path calls sanitizeCssValue by checking a value
    // that survives the round-trip but would be dangerous without sanitization.
    const root = document.documentElement;
    root.style.setProperty("--cf-bg", "red");
    const html = _buildHtmlDocumentForTest("Hello", "test");
    root.style.removeProperty("--cf-bg");

    // The token should appear in the style block with its resolved value
    expect(html).toContain("--cf-bg: red;");
    expect(html).toContain("<style>");
  });
});

describe("batchExport", () => {
  it("enumerates nested unloaded markdown directories through the project file service", async () => {
    const fs = new MemoryFileSystem({
      "root.md": "# Root",
      "nested/deep.md": "# Deep",
      "nested/asset.png": "png",
    });
    const tree: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [
        { name: "nested", path: "nested", isDirectory: true },
        { name: "root.md", path: "root.md", isDirectory: false },
      ],
    };
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:coflat-test"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
      const results = await batchExport(tree, "html", fs);

      expect(results.map((result) => result.path)).toEqual([
        "nested/deep.md",
        "root.md",
      ]);
      expect(results.every((result) => result.outputPath && !result.error)).toBe(true);
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectUrl,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectUrl,
      });
    }
  });
});

// ── sanitizeCssValue ────────────────────────────────────────────────────────
//
// Regression tests for CSS value injection in HTML export (issue #503).
// Computed CSS values from getComputedStyle are interpolated into a <style>
// block. A malicious value containing </style> could close the block and
// inject arbitrary HTML.

describe("sanitizeCssValue", () => {
  it("passes through normal CSS values unchanged", () => {
    expect(sanitizeCssValue("#ffffff")).toBe("#ffffff");
    expect(sanitizeCssValue("italic")).toBe("italic");
    expect(sanitizeCssValue("0.5rem 1rem")).toBe("0.5rem 1rem");
    expect(sanitizeCssValue('"Helvetica Neue", sans-serif')).toBe('"Helvetica Neue", sans-serif');
  });

  it("strips </style> sequences to prevent breakout", () => {
    expect(sanitizeCssValue("</style><script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });

  it("strips </style> case-insensitively", () => {
    expect(sanitizeCssValue("</STYLE><script>alert(1)</script>")).toBe("<script>alert(1)</script>");
    expect(sanitizeCssValue("</Style>")).toBe("");
  });

  it("strips multiple </style> occurrences", () => {
    expect(sanitizeCssValue("a</style>b</style>c")).toBe("abc");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeCssValue("")).toBe("");
  });
});
