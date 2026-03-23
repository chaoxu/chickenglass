import { describe, expect, it } from "vitest";
import { isSafeUrl } from "./url-utils";

describe("isSafeUrl", () => {
  // ── Allowed schemes ──────────────────────────────────────────────────────

  it("allows http URLs", () => {
    expect(isSafeUrl("http://example.com")).toBe(true);
  });

  it("allows https URLs", () => {
    expect(isSafeUrl("https://example.com/path?q=1")).toBe(true);
  });

  it("allows mailto URLs", () => {
    expect(isSafeUrl("mailto:user@example.com")).toBe(true);
  });

  it("allows tel URLs", () => {
    expect(isSafeUrl("tel:+1234567890")).toBe(true);
  });

  // ── Relative URLs ────────────────────────────────────────────────────────

  it("allows relative paths", () => {
    expect(isSafeUrl("images/photo.png")).toBe(true);
    expect(isSafeUrl("../docs/file.pdf")).toBe(true);
    expect(isSafeUrl("/absolute/path")).toBe(true);
  });

  it("allows fragment-only URLs", () => {
    expect(isSafeUrl("#section")).toBe(true);
  });

  it("allows query-only URLs", () => {
    expect(isSafeUrl("?key=value")).toBe(true);
  });

  it("allows empty string", () => {
    expect(isSafeUrl("")).toBe(true);
  });

  // ── Blocked schemes ──────────────────────────────────────────────────────

  it("blocks javascript: scheme", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
  });

  it("blocks data: scheme", () => {
    expect(isSafeUrl("data:text/html,<h1>hi</h1>")).toBe(false);
  });

  it("blocks vbscript: scheme", () => {
    expect(isSafeUrl("vbscript:MsgBox('hi')")).toBe(false);
  });

  // ── Mixed case ───────────────────────────────────────────────────────────

  it("blocks javascript: with mixed case", () => {
    expect(isSafeUrl("JavaScript:alert(1)")).toBe(false);
    expect(isSafeUrl("JAVASCRIPT:void(0)")).toBe(false);
    expect(isSafeUrl("jAvAsCrIpT:alert(1)")).toBe(false);
  });

  it("blocks data: with mixed case", () => {
    expect(isSafeUrl("Data:text/html,<h1>hi</h1>")).toBe(false);
    expect(isSafeUrl("DATA:text/html,test")).toBe(false);
  });

  it("blocks vbscript: with mixed case", () => {
    expect(isSafeUrl("VBScript:Run")).toBe(false);
    expect(isSafeUrl("VBSCRIPT:Run")).toBe(false);
  });

  // ── Whitespace edge cases ────────────────────────────────────────────────

  it("blocks javascript: with leading whitespace", () => {
    expect(isSafeUrl("  javascript:alert(1)")).toBe(false);
  });

  it("blocks javascript: with trailing whitespace", () => {
    expect(isSafeUrl("javascript:alert(1)  ")).toBe(false);
  });

  it("blocks javascript: with embedded newlines", () => {
    expect(isSafeUrl("java\nscript:alert(1)")).toBe(false);
  });

  it("blocks javascript: with embedded tabs", () => {
    expect(isSafeUrl("java\tscript:alert(1)")).toBe(false);
  });

  it("blocks javascript: with embedded carriage returns", () => {
    expect(isSafeUrl("java\rscript:alert(1)")).toBe(false);
  });

  it("blocks javascript: with mixed whitespace injection", () => {
    expect(isSafeUrl(" \n java\n\tscript:alert(1)")).toBe(false);
  });

  // ── Other blocked/unknown schemes ────────────────────────────────────────

  it("blocks ftp: scheme (not in allowlist)", () => {
    expect(isSafeUrl("ftp://example.com/file")).toBe(false);
  });

  it("blocks blob: scheme", () => {
    expect(isSafeUrl("blob:http://example.com/uuid")).toBe(false);
  });

  it("blocks file: scheme", () => {
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
  });
});
