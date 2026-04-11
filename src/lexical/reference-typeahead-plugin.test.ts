import { describe, expect, it } from "vitest";

import {
  applyBracketedReferenceCompletion,
  collectReferenceCompletionCandidates,
  filterReferenceCompletionCandidates,
  findReferenceCompletionMatch,
  type ReferenceCompletionCandidate,
  type ReferenceCompletionDependencies,
} from "../state/reference-completion-engine";

function makeCompletionDependencies(
  overrides?: Partial<ReferenceCompletionDependencies>,
): ReferenceCompletionDependencies {
  return {
    citations: {
      backlinks: new Map(),
      citedIds: [],
      store: new Map(),
    },
    labelGraph: {
      definitions: [],
      definitionsById: new Map(),
      duplicatesById: new Map(),
      references: [],
      referencesByTarget: new Map(),
      uniqueDefinitionById: new Map(),
    },
    renderIndex: {
      footnotes: new Map(),
      references: new Map(),
    },
    ...overrides,
  };
}

function makeCandidate(
  overrides: Partial<ReferenceCompletionCandidate> & Pick<ReferenceCompletionCandidate, "id" | "kind" | "label" | "previewSource">,
): ReferenceCompletionCandidate {
  return {
    detail: overrides.id,
    ...overrides,
  };
}

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

describe("collectReferenceCompletionCandidates", () => {
  it("builds candidates from the reference model and skips duplicate citation ids", () => {
    const dependencies = makeCompletionDependencies({
      citations: {
        backlinks: new Map(),
        citedIds: [],
        store: new Map([
          ["cite:knuth", {
            author: [{ family: "Knuth" }],
            id: "cite:knuth",
            issued: { "date-parts": [[1984]] },
            title: "Literate Programming",
            type: "book",
          }],
          ["thm:alpha", {
            id: "thm:alpha",
            title: "Duplicate citation should be ignored",
            type: "book",
          }],
        ]),
      },
      labelGraph: {
        definitions: [],
        definitionsById: new Map(),
        duplicatesById: new Map(),
        references: [],
        referencesByTarget: new Map(),
        uniqueDefinitionById: new Map([
          ["thm:alpha", {
            blockType: "theorem",
            content: "Block body",
            displayLabel: "thm:alpha",
            from: 0,
            id: "thm:alpha",
            kind: "block",
            labelFrom: 0,
            labelTo: 0,
            title: "  Fundamental Result  ",
            to: 0,
            tokenFrom: 0,
            tokenTo: 0,
          }],
          ["eq:gaussian", {
            displayLabel: "eq:gaussian",
            from: 0,
            id: "eq:gaussian",
            kind: "equation",
            labelFrom: 0,
            labelTo: 0,
            text: "x = y",
            to: 0,
            tokenFrom: 0,
            tokenTo: 0,
          }],
          ["sec:intro", {
            displayLabel: "1",
            from: 0,
            id: "sec:intro",
            kind: "heading",
            labelFrom: 0,
            labelTo: 0,
            text: "Introduction",
            title: "Introduction",
            to: 0,
            tokenFrom: 0,
            tokenTo: 0,
          }],
        ]),
      },
      renderIndex: {
        footnotes: new Map(),
        references: new Map([
          ["thm:alpha", { kind: "block", label: "Theorem 1" }],
          ["eq:gaussian", { kind: "equation", label: "Equation (1)", shortLabel: "(1)" }],
          ["sec:intro", { kind: "heading", label: "Section 1", shortLabel: "1" }],
        ]),
      },
    });

    expect(collectReferenceCompletionCandidates(dependencies)).toEqual([
      {
        detail: "thm:alpha",
        id: "thm:alpha",
        kind: "block",
        label: "Fundamental Result",
        previewSource: {
          bodyMarkdown: "Block body",
          blockType: "theorem",
          id: "thm:alpha",
          kind: "block",
          title: "  Fundamental Result  ",
        },
      },
      {
        detail: "eq:gaussian",
        id: "eq:gaussian",
        kind: "equation",
        label: "Equation (1)",
        previewSource: {
          id: "eq:gaussian",
          kind: "equation",
          text: "x = y",
        },
      },
      {
        detail: "sec:intro",
        id: "sec:intro",
        kind: "heading",
        label: "Introduction",
        previewSource: {
          kind: "heading",
          text: "Section 1",
        },
      },
      {
        detail: "Knuth 1984",
        id: "cite:knuth",
        kind: "citation",
        label: "cite:knuth",
        previewSource: {
          kind: "citation",
          text: expect.any(String),
        },
      },
    ]);
  });
});

describe("filterReferenceCompletionCandidates", () => {
  it("ranks exact ids before prefix, label, and secondary text matches", () => {
    const candidates = [
      makeCandidate({
        id: "alpha",
        kind: "heading",
        label: "Section 1",
        previewSource: { kind: "heading", text: "Section 1" },
      }),
      makeCandidate({
        id: "alpha-extra",
        kind: "heading",
        label: "Section 2",
        previewSource: { kind: "heading", text: "Section 2" },
      }),
      makeCandidate({
        id: "beta",
        kind: "heading",
        label: "Alpha theorem",
        previewSource: { kind: "heading", text: "Section 3" },
      }),
      makeCandidate({
        id: "gamma",
        kind: "citation",
        label: "Citation",
        previewSource: { kind: "citation", text: "Mentions alpha inside preview text" },
      }),
    ];

    expect(filterReferenceCompletionCandidates(candidates, " alpha ").map((candidate) => candidate.id)).toEqual([
      "alpha",
      "alpha-extra",
      "beta",
      "gamma",
    ]);
  });

  it("uses kind order as the tie-breaker for equally ranked matches", () => {
    const candidates = [
      makeCandidate({
        id: "zeta",
        kind: "citation",
        label: "Common value",
        previewSource: { kind: "citation", text: "Common value" },
      }),
      makeCandidate({
        id: "beta",
        kind: "heading",
        label: "Common value",
        previewSource: { kind: "heading", text: "Common value" },
      }),
      makeCandidate({
        id: "gamma",
        kind: "equation",
        label: "Common value",
        previewSource: { kind: "equation", id: "gamma", text: "x = y" },
      }),
      makeCandidate({
        id: "alpha",
        kind: "block",
        label: "Common value",
        previewSource: {
          bodyMarkdown: "Block body",
          id: "alpha",
          kind: "block",
        },
      }),
    ];

    expect(filterReferenceCompletionCandidates(candidates, "common").map((candidate) => candidate.kind)).toEqual([
      "block",
      "equation",
      "heading",
      "citation",
    ]);
  });
});
