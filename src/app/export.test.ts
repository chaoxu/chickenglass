import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "./file-manager";

const { resolvePdfImageOverridesMock } = vi.hoisted(() => ({
  resolvePdfImageOverridesMock: vi.fn(),
}));

vi.mock("./pdf-image-previews", () => ({
  resolvePdfImageOverrides: resolvePdfImageOverridesMock,
}));

import {
  _buildHtmlDocumentForTest,
  _buildHtmlDocumentAsyncForTest,
  _resolveExportThemeTokensForTest,
} from "./export";

beforeEach(() => {
  resolvePdfImageOverridesMock.mockReset();
  resolvePdfImageOverridesMock.mockResolvedValue(new Map());
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

  it("feeds prepared PDF preview overrides into exported HTML", async () => {
    const fs = {} as unknown as FileSystem;
    resolvePdfImageOverridesMock.mockResolvedValue(new Map([
      ["notes/fig.pdf", "data:image/png;base64,PDFPAGE1"],
    ]));

    const html = await _buildHtmlDocumentAsyncForTest(
      "![Figure](fig.pdf)",
      "sample",
      fs,
      "notes/main.md",
    );

    expect(resolvePdfImageOverridesMock).toHaveBeenCalledWith(
      "![Figure](fig.pdf)",
      fs,
      "notes/main.md",
    );
    expect(html).toContain('<img src="data:image/png;base64,PDFPAGE1" alt="Figure">');
    expect(html).not.toContain('<img src="fig.pdf" alt="Figure">');
  });
});
