import { describe, expect, it } from "vitest";
import { parseBracedId, readBracedLabelId } from "./label-utils";

describe("parseBracedId", () => {
  it("accepts prefixed ids with dots and dashes", () => {
    expect(parseBracedId("{#eq:my-equation.v2}", "eq:")).toBe("eq:my-equation.v2");
  });

  it("rejects prefixed ids whose suffix starts with punctuation", () => {
    expect(parseBracedId("{#eq:-bad}", "eq:")).toBeNull();
  });

  it("rejects prefixed ids whose suffix contains another colon", () => {
    expect(parseBracedId("{#eq:eq:system}", "eq:")).toBeNull();
  });
});

describe("readBracedLabelId", () => {
  it("extracts a braced label id", () => {
    const text = "$$x$$ {#eq:test}";
    expect(readBracedLabelId(text, 6, text.length, "eq:")).toBe("eq:test");
  });

  it("rejects labels with whitespace", () => {
    const text = "{#eq:bad label}";
    expect(readBracedLabelId(text, 0, text.length, "eq:")).toBeNull();
  });

  it("rejects prefixed labels whose suffix starts with punctuation", () => {
    const text = "{#eq:-bad}";
    expect(readBracedLabelId(text, 0, text.length, "eq:")).toBeNull();
  });

  it("rejects prefixed labels whose suffix contains another colon", () => {
    const text = "{#eq:eq:system}";
    expect(readBracedLabelId(text, 0, text.length, "eq:")).toBeNull();
  });

  it("supports generic labels without a required prefix", () => {
    const text = "{#thm-main}";
    expect(readBracedLabelId(text, 0, text.length)).toBe("thm-main");
  });
});
