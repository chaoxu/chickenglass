import { describe, expect, it } from "vitest";

import {
  applyBracketedReferenceCompletion,
  findReferenceCompletionMatch,
} from "./reference-typeahead-plugin";

describe("findReferenceCompletionMatch", () => {
  it("detects bracketed references at [@", () => {
    expect(findReferenceCompletionMatch("See [@thm")).toEqual({
      kind: "bracketed",
      leadOffset: 4,
      matchingString: "thm",
      replaceableString: "[@thm",
    });
  });

  it("detects the active slot inside clustered bracketed references", () => {
    expect(findReferenceCompletionMatch("See [@eq:one; @thm")).toEqual({
      kind: "bracketed",
      leadOffset: 4,
      matchingString: "thm",
      replaceableString: "[@eq:one; @thm",
    });
  });

  it("does not trigger inside locators", () => {
    expect(findReferenceCompletionMatch("See [@thm:main, p.")).toBeNull();
  });

  it("detects narrative references at @", () => {
    expect(findReferenceCompletionMatch("As @thm")).toEqual({
      kind: "narrative",
      leadOffset: 3,
      matchingString: "thm",
      replaceableString: "@thm",
    });
  });

  it("does not trigger inside email addresses", () => {
    expect(findReferenceCompletionMatch("Contact test@example.com")).toBeNull();
  });
});

describe("applyBracketedReferenceCompletion", () => {
  it("replaces the active slot inside a clustered reference", () => {
    expect(applyBracketedReferenceCompletion("[@eq:one; @thm", "thm:autocomplete"))
      .toBe("[@eq:one; @thm:autocomplete");
  });

  it("preserves leading whitespace in the active slot", () => {
    expect(applyBracketedReferenceCompletion("[ @thm", "thm:autocomplete"))
      .toBe("[ @thm:autocomplete");
  });
});
