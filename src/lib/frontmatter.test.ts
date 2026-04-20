import { describe, expect, it } from "vitest";

import {
  FRONTMATTER_DELIMITER_RE,
  parseFrontmatter,
} from "./frontmatter";
import { isFrontmatterDelimiterLine } from "./frontmatter-delimiter.js";

describe("frontmatter delimiter contract", () => {
  it("shares delimiter behavior with the JS-compatible preprocess helper", () => {
    for (const line of ["---", "---   ", "---\t"]) {
      expect(FRONTMATTER_DELIMITER_RE.test(line)).toBe(true);
      expect(isFrontmatterDelimiterLine(line)).toBe(true);
    }

    for (const line of [" ---", "----", "--- body"]) {
      expect(FRONTMATTER_DELIMITER_RE.test(line)).toBe(false);
      expect(isFrontmatterDelimiterLine(line)).toBe(false);
    }
  });

  it("parses frontmatter with closing delimiter whitespace", () => {
    const result = parseFrontmatter("---\ntitle: Paper\n---   \n\nBody");

    expect(result.config.title).toBe("Paper");
    expect(result.end).toBe("---\ntitle: Paper\n---   \n".length);
  });

  it("does not treat delimiter-like body lines as frontmatter", () => {
    const result = parseFrontmatter("Body\n\n---\ntitle: Not frontmatter\n---\n");

    expect(result.config).toEqual({});
    expect(result.end).toBe(-1);
  });
});
