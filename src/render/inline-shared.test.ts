import { describe, expect, it } from "vitest";
import { isSafeUrl, buildKatexOptions, MARK_NODES, sanitizeCslHtml } from "./inline-shared";

// ── isSafeUrl ──────────────────────────────────────────────────────────────

describe("isSafeUrl", () => {
  it("allows http URLs", () => {
    expect(isSafeUrl("http://example.com")).toBe(true);
  });

  it("allows https URLs", () => {
    expect(isSafeUrl("https://example.com/path?q=1")).toBe(true);
  });

  it("allows relative URLs", () => {
    expect(isSafeUrl("images/photo.png")).toBe(true);
    expect(isSafeUrl("../docs/file.pdf")).toBe(true);
    expect(isSafeUrl("/absolute/path")).toBe(true);
  });

  it("allows fragment-only URLs", () => {
    expect(isSafeUrl("#section")).toBe(true);
  });

  it("allows mailto URLs", () => {
    expect(isSafeUrl("mailto:user@example.com")).toBe(true);
  });

  it("blocks javascript: scheme", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
  });

  it("blocks javascript: with mixed case", () => {
    expect(isSafeUrl("JavaScript:alert(1)")).toBe(false);
    expect(isSafeUrl("JAVASCRIPT:void(0)")).toBe(false);
  });

  it("blocks javascript: with leading whitespace", () => {
    expect(isSafeUrl("  javascript:alert(1)")).toBe(false);
  });

  it("blocks data: scheme", () => {
    expect(isSafeUrl("data:text/html,<h1>hi</h1>")).toBe(false);
  });

  it("blocks data: with mixed case", () => {
    expect(isSafeUrl("Data:text/html,<h1>hi</h1>")).toBe(false);
  });

  it("blocks vbscript: scheme", () => {
    expect(isSafeUrl("vbscript:MsgBox('hi')")).toBe(false);
  });

  it("blocks vbscript: with mixed case", () => {
    expect(isSafeUrl("VBScript:Run")).toBe(false);
  });

  it("allows empty string", () => {
    expect(isSafeUrl("")).toBe(true);
  });
});

// ── buildKatexOptions ──────────────────────────────────────────────────────

describe("buildKatexOptions", () => {
  it("sets displayMode from argument", () => {
    expect(buildKatexOptions(true).displayMode).toBe(true);
    expect(buildKatexOptions(false).displayMode).toBe(false);
  });

  it("sets throwOnError to false", () => {
    expect(buildKatexOptions(false).throwOnError).toBe(false);
  });

  it("omits macros when not provided", () => {
    const opts = buildKatexOptions(false);
    expect(opts.macros).toBeUndefined();
  });

  it("spreads macros into a new object", () => {
    const original = { "\\R": "\\mathbb{R}" };
    const opts = buildKatexOptions(false, original);
    expect(opts.macros).toEqual({ "\\R": "\\mathbb{R}" });
    expect(opts.macros).not.toBe(original);
  });

  describe("trust callback", () => {
    const opts = buildKatexOptions(false);
    const trust = opts.trust as (ctx: {
      command: string;
      url?: string;
    }) => boolean;

    it("trusts \\href with https URL", () => {
      expect(trust({ command: "\\href", url: "https://example.com" })).toBe(
        true,
      );
    });

    it("trusts \\url with http URL", () => {
      expect(trust({ command: "\\url", url: "http://example.com" })).toBe(
        true,
      );
    });

    it("rejects \\href with javascript URL", () => {
      expect(trust({ command: "\\href", url: "javascript:alert(1)" })).toBe(
        false,
      );
    });

    it("rejects \\href with no URL", () => {
      expect(trust({ command: "\\href" })).toBe(false);
    });

    it("rejects unknown commands", () => {
      expect(trust({ command: "\\input", url: "https://x.com" })).toBe(false);
    });
  });
});

// ── sanitizeCslHtml ────────────────────────────────────────────────────────
//
// Regression tests for XSS via CSL/citeproc HTML output (issue #343).
// CSL engine output may embed user-supplied strings (titles, names) that
// contain script tags or javascript: URLs if the input BibTeX was crafted
// maliciously. sanitizeCslHtml must neutralise these before innerHTML use.

describe("sanitizeCslHtml", () => {
  it("passes through plain text unchanged", () => {
    expect(sanitizeCslHtml("Karger, D. R. 2000.")).toBe("Karger, D. R. 2000.");
  });

  it("preserves safe CSL formatting tags", () => {
    const input = '<span class="csl-entry"><i>Nature</i> <b>47</b>(1): 46.</span>';
    const output = sanitizeCslHtml(input);
    expect(output).toContain("<i>");
    expect(output).toContain("<b>");
    expect(output).toContain("<span");
  });

  it("strips <script> tags and their content", () => {
    // A malicious BibTeX title containing a script tag.
    const input = '<span class="csl-entry">Title<script>alert(1)</script></span>';
    const output = sanitizeCslHtml(input);
    expect(output).not.toContain("<script");
    expect(output).not.toContain("alert(1)");
  });

  it("strips <img> tags (not in allowlist)", () => {
    const input = '<span>text<img src="x" onerror="alert(1)">more</span>';
    const output = sanitizeCslHtml(input);
    expect(output).not.toContain("<img");
    expect(output).not.toContain("onerror");
  });

  it("strips event handler attributes from allowed tags", () => {
    const input = '<span onclick="alert(1)" class="csl-entry">text</span>';
    const output = sanitizeCslHtml(input);
    expect(output).not.toContain("onclick");
    expect(output).toContain("text");
  });

  it("strips javascript: href from <a> tags", () => {
    // The CSL engine could output a URL derived from user-supplied DOI/URL fields.
    const input = '<a href="javascript:alert(1)">click</a>';
    const output = sanitizeCslHtml(input);
    expect(output).not.toContain("javascript:");
    expect(output).toContain("click");
  });

  it("preserves safe https href on <a> tags", () => {
    const input = '<a href="https://doi.org/10.1145/123456" class="doi">DOI</a>';
    const output = sanitizeCslHtml(input);
    expect(output).toContain('href="https://doi.org/10.1145/123456"');
  });

  it("strips style attributes (not in allowlist)", () => {
    const input = '<span style="color:red">text</span>';
    const output = sanitizeCslHtml(input);
    expect(output).not.toContain("style=");
  });

  it("lifts children of stripped non-dangerous elements in place", () => {
    // <article> is not in SAFE_CSL_ELEMENTS (not a dangerous element either),
    // so its children should be lifted into the parent while the tag is removed.
    const input = '<div class="csl-entry"><article><span>preserved</span></article></div>';
    const output = sanitizeCslHtml(input);
    expect(output).not.toContain("<article");
    expect(output).toContain("preserved");
  });
});

// ── MARK_NODES ─────────────────────────────────────────────────────────────

describe("MARK_NODES", () => {
  it("is a Set", () => {
    expect(MARK_NODES).toBeInstanceOf(Set);
  });

  it("contains all expected mark node names", () => {
    const expected = [
      "EmphasisMark",
      "CodeMark",
      "LinkMark",
      "StrikethroughMark",
      "HighlightMark",
      "InlineMathMark",
      "HeaderMark",
      "ListMark",
      "TaskMarker",
      "TableDelimiter",
    ];
    for (const name of expected) {
      expect(MARK_NODES.has(name)).toBe(true);
    }
    expect(MARK_NODES.size).toBe(expected.length);
  });

  it("does not contain non-mark node names", () => {
    expect(MARK_NODES.has("Paragraph")).toBe(false);
    expect(MARK_NODES.has("Document")).toBe(false);
  });
});
