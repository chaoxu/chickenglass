import { describe, expect, it } from "vitest";

import {
  nextMatch,
  prevMatch,
  replaceAll,
  replaceOne,
  setQuery,
} from "./controller";
import type { SearchMatch, SearchOptions, SearchState } from "./model";

const DEFAULT_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

function createState(
  options: SearchOptions = DEFAULT_OPTIONS,
): SearchState {
  return {
    query: "",
    replacement: "",
    options,
    matches: [],
    activeIndex: null,
  };
}

function expectMatchesSorted(
  matches: ReadonlyArray<SearchMatch>,
): void {
  expect(matches.map((match) => match.from)).toEqual(
    [...matches].map((match) => match.from).sort((a, b) => a - b),
  );
}

function expectValidActiveIndex(state: SearchState): void {
  if (state.matches.length === 0) {
    expect(state.activeIndex).toBeNull();
    return;
  }
  expect(state.activeIndex).not.toBeNull();
  expect(state.activeIndex).toBeGreaterThanOrEqual(0);
  expect(state.activeIndex).toBeLessThan(state.matches.length);
}

describe("search controller invariants", () => {
  it("wraps next from the last match back to the first", () => {
    const doc = "alpha beta alpha";
    const initial = setQuery(createState(), "alpha", doc);
    const last = nextMatch(initial);

    const wrapped = nextMatch(last);

    expect(wrapped.activeIndex).toBe(0);
    expectValidActiveIndex(wrapped);
  });

  it("treats replaceAll with an empty query as a no-op", () => {
    const doc = "alpha beta alpha";
    const initial = createState();

    const result = replaceAll(initial, "z", doc);

    expect(result.edits).toEqual([]);
    expect(result.state).toEqual(initial);
  });

  it("keeps activeIndex valid after every reducer transition", () => {
    const doc = "alpha beta alpha gamma alpha";
    const valid = setQuery(createState(), "alpha", doc);
    const invalidHigh = { ...valid, activeIndex: 99 };
    const invalidLow = { ...valid, activeIndex: -1 };
    const noMatches = setQuery(createState(), "omega", doc);
    const transitions = [
      setQuery(invalidHigh, "alpha", doc),
      nextMatch(invalidHigh),
      prevMatch(invalidLow),
      replaceOne(invalidHigh, "z", doc).state,
      replaceAll(invalidHigh, "z", doc).state,
      nextMatch(noMatches),
      prevMatch(noMatches),
      replaceOne(noMatches, "z", doc).state,
      replaceAll(noMatches, "z", doc).state,
    ];

    for (const state of transitions) {
      expectValidActiveIndex(state);
    }
  });

  it("keeps matches sorted by from ascending", () => {
    const doc = "alpha\nbeta alpha\nalpha";
    const state = setQuery(createState(), "alpha", doc);

    expectMatchesSorted(state.matches);
    expect(state.matches).toEqual([
      { from: 0, to: 5, lineNumber: 1 },
      { from: 11, to: 16, lineNumber: 2 },
      { from: 17, to: 22, lineNumber: 3 },
    ]);
  });

  it("moves replaceOne focus to the next match, not the replaced one", () => {
    const doc = "alpha alpha alpha";
    const initial = setQuery(createState(), "alpha", doc);

    const result = replaceOne(initial, "alpha!", doc);

    expect(result.edit).toEqual({ from: 0, to: 5, insert: "alpha!" });
    expectMatchesSorted(result.state.matches);
    expectValidActiveIndex(result.state);
    expect(result.state.matches).toEqual([
      { from: 0, to: 5, lineNumber: 1 },
      { from: 7, to: 12, lineNumber: 1 },
      { from: 13, to: 18, lineNumber: 1 },
    ]);
    expect(result.state.activeIndex).toBe(1);
  });
});
