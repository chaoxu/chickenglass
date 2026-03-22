import { describe, expect, it } from "vitest";
import { isSafeUrl, buildKatexOptions, MARK_NODES } from "./inline-shared";

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
