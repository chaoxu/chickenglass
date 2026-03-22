import { describe, expect, it } from "vitest";
import { computeDocStats } from "./writing-stats";

describe("computeDocStats", () => {
  it("ignores YAML frontmatter when counting words", () => {
    const stats = computeDocStats([
      "---",
      "title: Example",
      "author: Chao",
      "---",
      "Hello world.",
    ].join("\n"));

    expect(stats.words).toBe(2);
    expect(stats.sentences).toBe(1);
  });

  it("leaves non-frontmatter leading rules alone", () => {
    const stats = computeDocStats([
      "--- not frontmatter",
      "Still body text.",
    ].join("\n"));

    expect(stats.words).toBe(6);
  });
});
