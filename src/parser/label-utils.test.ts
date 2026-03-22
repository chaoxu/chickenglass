import { describe, expect, it } from "vitest";
import { readBracedLabelId } from "./label-utils";

describe("readBracedLabelId", () => {
  it("extracts a braced label id", () => {
    const text = "$$x$$ {#eq:test}";
    expect(readBracedLabelId(text, 6, text.length, "eq:")).toBe("eq:test");
  });

  it("rejects labels with whitespace", () => {
    const text = "{#eq:bad label}";
    expect(readBracedLabelId(text, 0, text.length, "eq:")).toBeNull();
  });

  it("supports generic labels without a required prefix", () => {
    const text = "{#thm-main}";
    expect(readBracedLabelId(text, 0, text.length)).toBe("thm-main");
  });
});
