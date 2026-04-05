import { afterEach, describe, expect, it, vi } from "vitest";
import katex from "katex";
import { isSafeUrl } from "../lib/url-utils";
import { buildKatexOptions } from "../lib/katex-options";
import {
  MARK_NODES,
  clearKatexHtmlCache,
  renderKatexToHtml,
  sanitizeCslHtml,
  sanitizeRenderedHtml,
} from "./inline-shared";

afterEach(() => {
  vi.restoreAllMocks();
  clearKatexHtmlCache();
});

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

describe("renderKatexToHtml", () => {
  it("sanitizes rendered KaTeX HTML without dropping source-mapping metadata", () => {
    vi.spyOn(katex, "renderToString").mockReturnValue(
      '<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi href="javascript:alert(1)">x</mi></mrow><annotation encoding="application/x-tex">x</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><a href="javascript:alert(1)" data-loc-start="0" data-loc-end="1"><span class="mord" data-loc-start="0" data-loc-end="1">x</span></a><img src="x" onerror="alert(1)"></span></span>',
    );

    const html = renderKatexToHtml("\\text{issue908-inline}", false, {});

    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain('href="javascript:alert(1)"');
    expect(html).toContain('data-loc-start="0"');
    expect(html).toContain("<semantics>");
    expect(html).toContain('<annotation encoding="application/x-tex">x</annotation>');
  });

  it("preserves safe KaTeX links", () => {
    const html = renderKatexToHtml("\\href{https://example.com}{x}", false, {});
    expect(html).toContain('href="https://example.com"');
  });

  it("logs each KaTeX render failure only once per expression", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(katex, "renderToString").mockImplementation(() => {
      throw new Error("Bad math");
    });

    expect(() => renderKatexToHtml("\\bad", false, {})).toThrow("Bad math");
    expect(() => renderKatexToHtml("\\bad", false, {})).toThrow("Bad math");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[katex] failed to render math",
      { latex: "\\bad", isDisplay: false },
      expect.any(Error),
    );
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

describe("sanitizeRenderedHtml", () => {
  it("preserves KaTeX mathml metadata and data-image previews", () => {
    const output = sanitizeRenderedHtml(
      '<div><img src="data:image/png;base64,QUJD" alt="Preview"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x</annotation></semantics></math></div>',
    );

    expect(output).toContain('src="data:image/png;base64,QUJD"');
    expect(output).toContain("<semantics>");
    expect(output).toContain('encoding="application/x-tex"');
  });

  it("strips dangerous elements, event handlers, and unsafe URLs", () => {
    const output = sanitizeRenderedHtml(
      '<div><script>alert(1)</script><img src="https://example.com/img.png" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><img src="data:text/html;base64,PHNjcmlwdD4="></div>',
    );

    expect(output).not.toContain("<script");
    expect(output).not.toContain("alert(1)");
    expect(output).not.toContain("onerror");
    expect(output).not.toContain("javascript:");
    expect(output).toContain('src="https://example.com/img.png"');
    expect(output).not.toContain('src="data:text/html;base64,PHNjcmlwdD4="');
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
