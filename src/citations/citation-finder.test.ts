import { describe, expect, it } from "vitest";
import { type CslJsonItem } from "./bibtex-parser";
import { findCitations } from "./citation-finder";
import { findCitations as legacyFindCitations } from "./citation-render";
import { makeBibStore } from "../test-utils";

const karger: CslJsonItem = {
  id: "karger2000",
  type: "article-journal",
  author: [{ family: "Karger", given: "David R." }],
  title: "Minimum cuts in near-linear time",
  issued: { "date-parts": [[2000]] },
  "container-title": "JACM",
};

const stein: CslJsonItem = {
  id: "stein2001",
  type: "book",
  author: [{ family: "Stein", given: "Clifford" }],
  title: "Algorithms",
  issued: { "date-parts": [[2001]] },
};

const store = makeBibStore([karger, stein]);

describe("findCitations", () => {
  it("preserves the citation-render export path", () => {
    expect(legacyFindCitations).toBe(findCitations);
  });

  it("finds a single parenthetical citation", () => {
    const matches = findCitations("See [@karger2000] for details.", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].from).toBe(4);
    expect(matches[0].to).toBe(17);
    expect(matches[0].parenthetical).toBe(true);
    expect(matches[0].ids).toEqual(["karger2000"]);
  });

  it("finds multiple citations in brackets", () => {
    const matches = findCitations("See [@karger2000; @stein2001].", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].ids).toEqual(["karger2000", "stein2001"]);
    expect(matches[0].parenthetical).toBe(true);
  });

  it("finds narrative citations", () => {
    const matches = findCitations("As shown by @karger2000, the result holds.", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].parenthetical).toBe(false);
    expect(matches[0].ids).toEqual(["karger2000"]);
  });

  it("ignores citations not in the store", () => {
    const matches = findCitations("See [@unknown2020] for details.", store);
    expect(matches).toHaveLength(0);
  });

  it("treats as citation only if at least one id is in store", () => {
    const matches = findCitations("See [@karger2000; @unknown2020].", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].ids).toEqual(["karger2000", "unknown2020"]);
  });

  it("does not match @id inside brackets as narrative", () => {
    const matches = findCitations("[@karger2000]", store);
    const narrative = matches.filter((match) => !match.parenthetical);
    expect(narrative).toHaveLength(0);
  });

  it("handles multiple separate citations", () => {
    const text = "See [@karger2000] and [@stein2001].";
    const matches = findCitations(text, store);
    expect(matches).toHaveLength(2);
    expect(matches[0].ids).toEqual(["karger2000"]);
    expect(matches[1].ids).toEqual(["stein2001"]);
  });

  it("returns empty for text with no citations", () => {
    expect(findCitations("No citations here.", store)).toHaveLength(0);
  });

  it("parses a citation with a locator", () => {
    const matches = findCitations("See [@karger2000, chap. 36].", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].ids).toEqual(["karger2000"]);
    expect(matches[0].locators).toEqual(["chap. 36"]);
  });

  it("parses a citation with page locator", () => {
    const matches = findCitations("[@karger2000, pp. 100-120]", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].ids).toEqual(["karger2000"]);
    expect(matches[0].locators).toEqual(["pp. 100-120"]);
  });

  it("parses multiple citations each with locators", () => {
    const matches = findCitations("[@karger2000, theorem 3; @stein2001, p. 42]", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].ids).toEqual(["karger2000", "stein2001"]);
    expect(matches[0].locators).toEqual(["theorem 3", "p. 42"]);
  });

  it("handles mixed citations with and without locators", () => {
    const matches = findCitations("[@karger2000; @stein2001, chap. 5]", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].ids).toEqual(["karger2000", "stein2001"]);
    expect(matches[0].locators).toEqual([undefined, "chap. 5"]);
  });

  it("returns undefined locators when none present", () => {
    const matches = findCitations("[@karger2000]", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].locators).toEqual([undefined]);
  });

  describe("negative / edge-case", () => {
    it("returns empty array for empty string", () => {
      expect(findCitations("", store)).toHaveLength(0);
    });

    it("returns empty array when store is empty", () => {
      const emptyStore = makeBibStore([]);
      expect(findCitations("[@karger2000]", emptyStore)).toHaveLength(0);
    });

    it("does not match bare @ without an id", () => {
      expect(findCitations("email@example.com", store)).toHaveLength(0);
    });

    it("handles only brackets with no @ sign", () => {
      expect(findCitations("[no citation here]", store)).toHaveLength(0);
    });
  });
});
