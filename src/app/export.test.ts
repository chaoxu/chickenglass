import { afterEach, describe, expect, it } from "vitest";
import {
  _buildHtmlDocumentForTest,
  _resolveExportThemeTokensForTest,
} from "./export";

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
  it("uses theme CSS variables instead of hardcoded export colors", () => {
    const html = _buildHtmlDocumentForTest(
      "::: {.theorem} Title\nBody\n:::\n\nA [link](https://example.com).\n\n`code`",
      "sample",
    );

    expect(html).toContain("--cf-bg: #ffffff;");
    expect(html).toContain("color: var(--cf-fg);");
    expect(html).toContain("background: var(--cf-hover);");
    expect(html).toContain(".cf-block-theorem");
    expect(html).toContain("font-style: var(--cf-block-theorem-style);");
    expect(html).toContain("border-top: 1px solid var(--cf-border);");
    expect(html).not.toContain("color: #111;");
    expect(html).not.toContain("background: #fff;");
    expect(html).not.toContain("border-left: 3px solid #4a9eff;");
  });
});
