import { describe, expect, it } from "vitest";

import type { SearchMatch, SearchOptions, SearchState } from "./model";

describe("SearchState", () => {
  it("captures both empty and populated search snapshots", () => {
    const emptyOptions: SearchOptions = {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    };
    const emptyState: SearchState = {
      query: "",
      options: emptyOptions,
      matches: [],
      activeIndex: null,
    };

    const matches: ReadonlyArray<SearchMatch> = [
      { from: 12, to: 17, lineNumber: 3 },
    ];
    const populatedState: SearchState = {
      query: "alpha",
      options: {
        caseSensitive: true,
        wholeWord: true,
        regex: false,
      },
      matches,
      activeIndex: 0,
    };

    expect(emptyState).toEqual({
      query: "",
      options: {
        caseSensitive: false,
        wholeWord: false,
        regex: false,
      },
      matches: [],
      activeIndex: null,
    });
    expect(populatedState.matches).toEqual(matches);
    expect(populatedState.activeIndex).toBe(0);
  });
});
