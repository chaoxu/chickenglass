import type { SearchMatch, SearchOptions, SearchState } from "./model";

const SEARCH_REGEXP_BASE_FLAGS = "gmu";
const REPLACEMENT_REGEXP_BASE_FLAGS = "mu";
const WORD_CHAR_RE = /[\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Connector_Punctuation}\u200c\u200d]/u;

export interface SearchEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface SearchReplaceOneResult {
  readonly state: SearchState;
  readonly edit: SearchEdit | null;
}

export interface SearchReplaceAllResult {
  readonly state: SearchState;
  readonly edits: ReadonlyArray<SearchEdit>;
}

export function setQuery(
  state: SearchState,
  query: string,
  doc: string,
): SearchState {
  const matches = collectMatches(doc, query, state.options);
  return {
    query,
    options: state.options,
    matches,
    activeIndex: matches.length > 0 ? 0 : null,
  };
}

export function nextMatch(state: SearchState): SearchState {
  if (state.matches.length === 0) {
    return { ...state, activeIndex: null };
  }
  const current = getDirectionalActiveIndex(state, "next");
  return {
    ...state,
    activeIndex: (current + 1) % state.matches.length,
  };
}

export function prevMatch(state: SearchState): SearchState {
  if (state.matches.length === 0) {
    return { ...state, activeIndex: null };
  }
  const current = getDirectionalActiveIndex(state, "prev");
  return {
    ...state,
    activeIndex: (current - 1 + state.matches.length) % state.matches.length,
  };
}

export function replaceOne(
  state: SearchState,
  replacement: string,
  doc: string,
): SearchReplaceOneResult {
  const currentState = refreshState(state, doc);
  if (currentState.activeIndex === null) {
    return { state: currentState, edit: null };
  }

  const activeMatch = currentState.matches[currentState.activeIndex];
  const edit: SearchEdit = {
    from: activeMatch.from,
    to: activeMatch.to,
    insert: getReplacementText(doc, activeMatch, currentState, replacement),
  };

  const nextDoc = applyEdits(doc, [edit]);
  const refreshedState = refreshState(currentState, nextDoc);
  return {
    edit,
    state: {
      ...refreshedState,
      activeIndex: findNextActiveIndex(refreshedState.matches, edit.from + edit.insert.length),
    },
  };
}

export function replaceAll(
  state: SearchState,
  replacement: string,
  doc: string,
): SearchReplaceAllResult {
  const currentState = refreshState(state, doc);
  if (currentState.matches.length === 0) {
    return { state: currentState, edits: [] };
  }

  const edits = currentState.matches.map((match) => ({
    from: match.from,
    to: match.to,
    insert: getReplacementText(doc, match, currentState, replacement),
  }));
  const nextDoc = applyEdits(doc, edits);

  return {
    edits,
    state: setQuery(currentState, currentState.query, nextDoc),
  };
}

function refreshState(state: SearchState, doc: string): SearchState {
  const matches = collectMatches(doc, state.query, state.options);
  return {
    ...state,
    matches,
    activeIndex: normalizeActiveIndex(state.activeIndex, matches.length),
  };
}

function normalizeActiveIndex(
  activeIndex: number | null,
  matchCount: number,
): number | null {
  if (matchCount === 0) {
    return null;
  }
  if (activeIndex === null || activeIndex < 0 || activeIndex >= matchCount) {
    return 0;
  }
  return activeIndex;
}

function getDirectionalActiveIndex(
  state: SearchState,
  direction: "next" | "prev",
): number {
  if (state.activeIndex === null || state.activeIndex < 0 || state.activeIndex >= state.matches.length) {
    return direction === "next" ? state.matches.length - 1 : 0;
  }
  return state.activeIndex;
}

function findNextActiveIndex(
  matches: ReadonlyArray<SearchMatch>,
  anchor: number,
): number | null {
  if (matches.length === 0) {
    return null;
  }
  const nextIndex = matches.findIndex((match) => match.from >= anchor);
  return nextIndex === -1 ? 0 : nextIndex;
}

function collectMatches(
  doc: string,
  query: string,
  options: SearchOptions,
): ReadonlyArray<SearchMatch> {
  if (!query) {
    return [];
  }

  const pattern = createSearchRegExp(query, options);
  if (pattern === null) {
    return [];
  }

  const matches: SearchMatch[] = [];
  let lineNumber = 1;
  let nextLineBreak = doc.indexOf("\n");

  for (let match = pattern.exec(doc); match !== null; match = pattern.exec(doc)) {
    const from = match.index;
    const to = from + match[0].length;

    if (passesWholeWordBoundary(doc, from, to, options.wholeWord)) {
      while (nextLineBreak !== -1 && nextLineBreak < from) {
        lineNumber += 1;
        nextLineBreak = doc.indexOf("\n", nextLineBreak + 1);
      }
      matches.push({ from, to, lineNumber });
    }

    if (from === to) {
      pattern.lastIndex = advanceStringIndex(doc, pattern.lastIndex);
    }
  }

  return matches;
}

function createSearchRegExp(
  query: string,
  options: SearchOptions,
): RegExp | null {
  const flags = `${SEARCH_REGEXP_BASE_FLAGS}${options.caseSensitive ? "" : "i"}`;
  const source = options.regex ? query : escapeRegExp(query);

  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

function getReplacementText(
  doc: string,
  match: SearchMatch,
  state: SearchState,
  replacement: string,
): string {
  if (!state.options.regex) {
    return replacement;
  }

  const pattern = createReplacementRegExp(state.query, state.options);
  if (pattern === null) {
    return replacement;
  }

  pattern.lastIndex = match.from;
  const result = pattern.exec(doc);
  if (result === null || result.index !== match.from || result[0].length !== match.to - match.from) {
    return replacement;
  }

  return expandReplacement(replacement, result);
}

function createReplacementRegExp(
  query: string,
  options: SearchOptions,
): RegExp | null {
  const flags = `${REPLACEMENT_REGEXP_BASE_FLAGS}${options.caseSensitive ? "" : "i"}y`;
  try {
    return new RegExp(query, flags);
  } catch {
    return null;
  }
}

function expandReplacement(
  replacement: string,
  match: RegExpExecArray,
): string {
  return replacement.replace(/\$([$&]|\d+)/g, (token, specifier) => {
    if (specifier === "&") {
      return match[0];
    }
    if (specifier === "$") {
      return "$";
    }
    for (let digits = specifier.length; digits > 0; digits -= 1) {
      const groupIndex = Number(specifier.slice(0, digits));
      if (groupIndex > 0 && groupIndex < match.length) {
        return `${match[groupIndex] ?? ""}${specifier.slice(digits)}`;
      }
    }
    return token;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function passesWholeWordBoundary(
  doc: string,
  from: number,
  to: number,
  wholeWord: boolean,
): boolean {
  if (!wholeWord) {
    return true;
  }
  if (from === to) {
    return true;
  }

  const before = charBefore(doc, from);
  const after = charAfter(doc, to);
  const first = charAfter(doc, from);
  const last = charBefore(doc, to);

  return (!isWordChar(before) || !isWordChar(first)) && (!isWordChar(after) || !isWordChar(last));
}

function isWordChar(char: string): boolean {
  return char.length > 0 && WORD_CHAR_RE.test(char);
}

function charBefore(text: string, index: number): string {
  if (index <= 0) {
    return "";
  }
  const previousCodePoint = text.codePointAt(index - 1);
  if (previousCodePoint === undefined) {
    return "";
  }
  return previousCodePoint > 0xffff && index >= 2
    ? text.slice(index - 2, index)
    : text.slice(index - 1, index);
}

function charAfter(text: string, index: number): string {
  if (index >= text.length) {
    return "";
  }
  const nextCodePoint = text.codePointAt(index);
  return nextCodePoint === undefined ? "" : String.fromCodePoint(nextCodePoint);
}

function advanceStringIndex(text: string, index: number): number {
  if (index >= text.length) {
    return text.length + 1;
  }
  const codePoint = text.codePointAt(index);
  return index + (codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
}

function applyEdits(
  doc: string,
  edits: ReadonlyArray<SearchEdit>,
): string {
  if (edits.length === 0) {
    return doc;
  }

  let cursor = 0;
  let nextDoc = "";
  for (const edit of edits) {
    nextDoc += doc.slice(cursor, edit.from);
    nextDoc += edit.insert;
    cursor = edit.to;
  }
  nextDoc += doc.slice(cursor);
  return nextDoc;
}
