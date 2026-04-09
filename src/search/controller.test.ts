import { describe, expect, it } from "vitest";

import {
  nextMatch,
  prevMatch,
  replaceAll,
  replaceOne,
  setQuery,
} from "./controller";
import type { SearchOptions, SearchState } from "./model";

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
    options,
    matches: [],
    activeIndex: null,
  };
}

describe("search controller", () => {
  it("recomputes matches for 0, 1, and many results and selects the first match", () => {
    const zeroResults = setQuery(createState(), "omega", "alpha beta");
    expect(zeroResults).toEqual({
      query: "omega",
      options: DEFAULT_OPTIONS,
      matches: [],
      activeIndex: null,
    });

    const oneResult = setQuery(createState(), "beta", "alpha beta");
    expect(oneResult).toEqual({
      query: "beta",
      options: DEFAULT_OPTIONS,
      matches: [{ from: 6, to: 10, lineNumber: 1 }],
      activeIndex: 0,
    });

    const manyResults = setQuery(
      createState(),
      "alpha",
      "alpha\nbeta alpha\nalpha",
    );
    expect(manyResults).toEqual({
      query: "alpha",
      options: DEFAULT_OPTIONS,
      matches: [
        { from: 0, to: 5, lineNumber: 1 },
        { from: 11, to: 16, lineNumber: 2 },
        { from: 17, to: 22, lineNumber: 3 },
      ],
      activeIndex: 0,
    });
  });

  it("treats invalid regular expressions as no-op queries", () => {
    const regexState = createState({
      caseSensitive: false,
      wholeWord: false,
      regex: true,
    });

    expect(setQuery(regexState, "(", "alpha")).toEqual({
      query: "(",
      options: regexState.options,
      matches: [],
      activeIndex: null,
    });
  });

  it("respects whole-word and case-sensitive options when recomputing matches", () => {
    const state = createState({
      caseSensitive: true,
      wholeWord: true,
      regex: false,
    });

    expect(setQuery(state, "ana", "banana ana Ana")).toEqual({
      query: "ana",
      options: state.options,
      matches: [{ from: 7, to: 10, lineNumber: 1 }],
      activeIndex: 0,
    });
  });

  it("does not treat astral-plane letters as a whole-word boundary", () => {
    const state = createState({
      caseSensitive: true,
      wholeWord: true,
      regex: false,
    });

    expect(setQuery(state, "ana", "𝒜ana ana")).toEqual({
      query: "ana",
      options: state.options,
      matches: [{ from: 6, to: 9, lineNumber: 1 }],
      activeIndex: 0,
    });
  });

  it("wraps to the first match when advancing past the end", () => {
    const doc = "alpha beta alpha";
    const state = setQuery(createState(), "alpha", doc);

    const second = nextMatch(state);
    expect(second.activeIndex).toBe(1);

    const wrapped = nextMatch(second);
    expect(wrapped.activeIndex).toBe(0);
  });

  it("wraps to the last match when moving backward from the first result", () => {
    const doc = "alpha beta alpha";
    const state = setQuery(createState(), "alpha", doc);

    const wrapped = prevMatch(state);
    expect(wrapped.activeIndex).toBe(1);
  });

  it("replaces the active match and advances to the next surviving result", () => {
    const doc = "alpha alpha alpha";
    const initial = setQuery(createState(), "alpha", doc);
    const activeMiddle = nextMatch(initial);

    const result = replaceOne(activeMiddle, "z", doc);

    expect(result.edit).toEqual({ from: 6, to: 11, insert: "z" });
    expect(result.state.matches).toEqual([
      { from: 0, to: 5, lineNumber: 1 },
      { from: 8, to: 13, lineNumber: 1 },
    ]);
    expect(result.state.activeIndex).toBe(1);
  });

  it("wraps replacement focus when the active match was the last result", () => {
    const doc = "alpha alpha";
    const initial = setQuery(createState(), "alpha", doc);
    const activeLast = nextMatch(initial);

    const result = replaceOne(activeLast, "z", doc);

    expect(result.edit).toEqual({ from: 6, to: 11, insert: "z" });
    expect(result.state.matches).toEqual([
      { from: 0, to: 5, lineNumber: 1 },
    ]);
    expect(result.state.activeIndex).toBe(0);
  });

  it("applies regex capture replacements for replaceOne", () => {
    const regexState = createState({
      caseSensitive: false,
      wholeWord: false,
      regex: true,
    });
    const doc = "alpha-1 beta-2";
    const initial = setQuery(regexState, "([a-z]+)-(\\d+)", doc);

    const result = replaceOne(initial, "$2:$1", doc);

    expect(result.edit).toEqual({ from: 0, to: 7, insert: "1:alpha" });
    expect(result.state.matches).toEqual([
      { from: 8, to: 14, lineNumber: 1 },
    ]);
    expect(result.state.activeIndex).toBe(0);
  });

  it("replaces all matches from the original non-overlapping match list", () => {
    const doc = "banana";
    const initial = setQuery(createState(), "ana", doc);

    const result = replaceAll(initial, "X", doc);

    expect(result.edits).toEqual([
      { from: 1, to: 4, insert: "X" },
    ]);
    expect(result.state).toEqual({
      query: "ana",
      options: DEFAULT_OPTIONS,
      matches: [],
      activeIndex: null,
    });
  });
});
