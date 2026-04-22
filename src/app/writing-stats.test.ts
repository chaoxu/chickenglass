import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";

import { computeDocStats, computeLiveStats, computeLiveStatsFromText } from "./writing-stats";

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

    // Intl.Segmenter correctly treats "---" as punctuation, not a word.
    // Old regex split counted it as a word token; 5 is the accurate count.
    expect(stats.words).toBe(5);
  });

  it("counts CJK characters as individual words", () => {
    // Intl.Segmenter handles CJK text by segmenting each character (or
    // multi-character word) as a word-like segment, unlike regex split
    // which would count the entire run as a single token.
    const stats = computeDocStats("This has Chinese text.");
    expect(stats.words).toBeGreaterThan(0);
    expect(stats.sentences).toBe(1);

    // Pure CJK text
    const cjk = computeDocStats("今天天气很好。明天也不错。");
    expect(cjk.words).toBeGreaterThan(0);
    expect(cjk.sentences).toBe(2);

    // Mixed Latin and CJK
    const mixed = computeDocStats("Hello 世界! Goodbye 再见。");
    expect(mixed.words).toBeGreaterThanOrEqual(4);
    expect(mixed.sentences).toBeGreaterThanOrEqual(1);
  });

  it("handles empty and whitespace-only text", () => {
    const empty = computeDocStats("");
    expect(empty.words).toBe(0);
    expect(empty.sentences).toBe(0);
    expect(empty.readingMinutes).toBe(0);

    const whitespace = computeDocStats("   \n\n   ");
    expect(whitespace.words).toBe(0);
    expect(whitespace.sentences).toBe(0);
  });

  it("counts multiple sentences correctly", () => {
    const stats = computeDocStats("First sentence. Second sentence! Third?");
    expect(stats.sentences).toBe(3);
  });
});

describe("computeLiveStats", () => {
  it("returns word and char counts consistent with computeDocStats", () => {
    const text = "Hello world. This is a test.";
    const live = computeLiveStats(text);
    const full = computeDocStats(text);
    expect(live.words).toBe(full.words);
    expect(live.chars).toBe(full.chars);
  });

  it("strips frontmatter before counting", () => {
    const text = ["---", "title: Test", "---", "One two."].join("\n");
    const live = computeLiveStats(text);
    expect(live.words).toBe(2);
    // chars = body after frontmatter (past the closing ---\n)
    expect(live.chars).toBe("One two.".length);
  });

  it("handles empty text", () => {
    const live = computeLiveStats("");
    expect(live.words).toBe(0);
    expect(live.chars).toBe(0);
  });

  it("does not include sentence count or reading time", () => {
    const live = computeLiveStats("Hello world.");
    // computeLiveStats returns only { words, chars }
    expect(Object.keys(live).sort()).toEqual(["chars", "words"]);
  });
});

describe("computeLiveStatsFromText", () => {
  it("matches string live stats without materializing the full document", () => {
    const text = [
      "---",
      "title: Test",
      "math:",
      "  \\R: \"\\\\mathbb{R}\"",
      "---",
      "One two.",
      "",
      "Hello 世界!",
    ].join("\n");

    expect(computeLiveStatsFromText(Text.of(text.split("\n")))).toEqual(computeLiveStats(text));
  });

  it("leaves non-frontmatter leading rules alone", () => {
    const text = ["--- not frontmatter", "Still body text."].join("\n");

    expect(computeLiveStatsFromText(Text.of(text.split("\n")))).toEqual(computeLiveStats(text));
  });

  it("handles frontmatter without a body", () => {
    const text = ["---", "title: Empty", "---"].join("\n");

    expect(computeLiveStatsFromText(Text.of(text.split("\n")))).toEqual({ words: 0, chars: 0 });
  });

  it("strips malformed frontmatter by delimiter boundaries", () => {
    const text = ["---", "title: [broken", "---", "Body text."].join("\n");

    expect(computeLiveStatsFromText(Text.of(text.split("\n")))).toEqual(computeLiveStats(text));
  });

  it("matches string stats across long, mixed-language lines", () => {
    const text = [
      "alpha_beta_gamma_delta_epsilon_zeta_eta_theta_iota_kappa_lambda_mu",
      "Hello 世界 and citation [@thm:main-upper] on the same line.",
      "URL-ish text https://example.test/path-to-resource should stay consistent.",
    ].join("\n");

    expect(computeLiveStatsFromText(Text.of(text.split("\n")))).toEqual(computeLiveStats(text));
  });

  it("matches string stats when buffered word counting flushes across many lines", () => {
    const body = Array.from(
      { length: 700 },
      (_, index) => `line ${index} has alpha beta gamma and 世界 tokens`,
    ).join("\n");
    const text = ["---", "title: Large", "---", body].join("\n");

    expect(body.length).toBeGreaterThan(16_384);
    expect(computeLiveStatsFromText(Text.of(text.split("\n")))).toEqual(computeLiveStats(text));
  });
});
