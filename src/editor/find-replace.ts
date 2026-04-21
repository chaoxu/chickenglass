/**
 * Coflat-native search subsystem: state, query helpers, panel UI, and keybindings.
 *
 * Uses CM6's `@codemirror/search` as the engine, but replaces the stock panel
 * with a custom DOM panel styled with the Coflat design system (--cf-* tokens).
 *
 * Features:
 * - Search query input with live match count (current / total)
 * - Case-sensitive, regex, whole-word toggles
 * - Next / Previous navigation
 * - Replace input with Replace / Replace All buttons
 * - Cmd+F opens find, Cmd+H opens find-and-replace
 * - Escape closes the panel and returns focus to the editor
 */

import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  SearchQuery,
  search,
  searchKeymap,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import { type Extension, StateEffect, StateField } from "@codemirror/state";
import {
  type EditorView,
  keymap,
  type Panel,
  type ViewUpdate,
} from "@codemirror/view";
import { CSS } from "../constants";

export {
  collectVisibleSearchMatches,
  type SearchMatchRange,
} from "../search/search-matches";

// ===========================================================================
// Search controller state
// ===========================================================================

export interface SearchUiState {
  readonly replaceVisible: boolean;
  /** Persisted toggle state so options survive panel close/reopen. */
  readonly caseSensitive: boolean;
  readonly isRegexp: boolean;
  readonly wholeWord: boolean;
}

export interface SearchControllerState extends SearchUiState {
  readonly panelOpen: boolean;
  readonly query: SearchQuery;
  readonly current: number;
  readonly total: number;
}

export interface SearchMatchSpan {
  readonly from: number;
  readonly to: number;
}

export const MAX_CACHED_SEARCH_MATCH_RANGES = 10_000;

const DEFAULT_SEARCH_UI_STATE: SearchUiState = {
  replaceVisible: false,
  caseSensitive: false,
  isRegexp: false,
  wholeWord: false,
};

export const setSearchUiStateEffect = StateEffect.define<Partial<SearchUiState>>();

export const searchUiStateField = StateField.define<SearchUiState>({
  create() {
    return DEFAULT_SEARCH_UI_STATE;
  },
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setSearchUiStateEffect)) {
        next = { ...next, ...effect.value };
      }
    }
    return next;
  },
});

export const searchControllerExtensions: Extension = [searchUiStateField];

// ===========================================================================
// Query and match helpers
// ===========================================================================

export function countSearchMatches(
  view: EditorView,
): { current: number; total: number } {
  return collectSearchMatchSummary(view);
}

function collectSearchMatchSummary(
  view: EditorView,
): { current: number; total: number; ranges: readonly SearchMatchSpan[] | null } {
  const query = getSearchQuery(view.state);
  if (!query.valid) return { current: 0, total: 0, ranges: [] };

  const cursor = query.getCursor(view.state);
  const sel = view.state.selection.main;
  const ranges: SearchMatchSpan[] = [];
  let cacheRanges = true;
  let total = 0;
  let current = 0;

  for (let result = cursor.next(); !result.done; result = cursor.next()) {
    total++;
    if (cacheRanges) {
      if (ranges.length < MAX_CACHED_SEARCH_MATCH_RANGES) {
        ranges.push({ from: result.value.from, to: result.value.to });
      } else {
        ranges.length = 0;
        cacheRanges = false;
      }
    }
    if (result.value.from === sel.from && result.value.to === sel.to) {
      current = total;
    }
  }

  return { current, total, ranges: cacheRanges ? ranges : null };
}

function findMatchOrdinal(
  ranges: readonly SearchMatchSpan[],
  selected: SearchMatchSpan,
): number {
  let low = 0;
  let high = ranges.length - 1;
  let firstCandidate = ranges.length;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (ranges[mid].from >= selected.from) {
      firstCandidate = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  for (
    let index = firstCandidate;
    index < ranges.length && ranges[index].from === selected.from;
    index += 1
  ) {
    if (ranges[index].to === selected.to) return index + 1;
  }

  return 0;
}

export function getSearchControllerState(view: EditorView): SearchControllerState {
  const ui = view.state.field(searchUiStateField);
  const matches = countSearchMatches(view);
  return {
    ...ui,
    panelOpen: searchPanelOpen(view.state),
    query: getSearchQuery(view.state),
    current: matches.current,
    total: matches.total,
  };
}

// ===========================================================================
// Controller commands
// ===========================================================================

export function setSearchUiState(
  view: EditorView,
  next: Partial<SearchUiState>,
): void {
  view.dispatch({
    effects: setSearchUiStateEffect.of(next),
  });
}

export function setSearchControllerQuery(
  view: EditorView,
  next: {
    readonly search: string;
    readonly replace: string;
    readonly caseSensitive: boolean;
    readonly regexp: boolean;
    readonly wholeWord: boolean;
  },
): void {
  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({
        search: next.search,
        replace: next.replace,
        caseSensitive: next.caseSensitive,
        regexp: next.regexp,
        wholeWord: next.wholeWord,
      }),
    ),
  });
}

export function openFindSearch(view: EditorView): boolean {
  setSearchUiState(view, { replaceVisible: false });
  openSearchPanel(view);
  return true;
}

export function openReplaceSearch(view: EditorView): boolean {
  setSearchUiState(view, { replaceVisible: true });
  openSearchPanel(view);
  return true;
}

export function closeSearch(view: EditorView): boolean {
  closeSearchPanel(view);
  return true;
}

export function nextSearchMatch(view: EditorView): void {
  findNext(view);
}

export function previousSearchMatch(view: EditorView): void {
  findPrevious(view);
}

export function replaceCurrentSearchMatch(view: EditorView): void {
  replaceNext(view);
}

export function replaceAllSearchMatches(view: EditorView): void {
  replaceAll(view);
}

// ===========================================================================
// Toggle button helper
// ===========================================================================

function createToggle(
  label: string,
  ariaLabel: string,
  initialActive: boolean,
  onChange: (active: boolean) => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.setAttribute("aria-label", ariaLabel);
  btn.className = CSS.searchToggle;
  btn.setAttribute("aria-pressed", String(initialActive));
  if (initialActive) btn.classList.add(CSS.searchToggleActive);

  btn.addEventListener("mousedown", (e) => {
    e.preventDefault(); // Prevent focus steal
  });
  btn.addEventListener("click", () => {
    try {
      const next = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", String(next));
      btn.classList.toggle(CSS.searchToggleActive, next);
      onChange(next);
    } catch (e: unknown) {
      console.error("[find-replace] toggle click handler failed", e);
    }
  });
  return btn;
}

// ===========================================================================
// Action button helper
// ===========================================================================

function createAction(
  label: string,
  ariaLabel: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.setAttribute("aria-label", ariaLabel);
  btn.className = CSS.searchAction;
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", () => {
    try {
      onClick();
    } catch (e: unknown) {
      console.error("[find-replace] action click handler failed", e);
    }
  });
  return btn;
}

// ===========================================================================
// Custom search panel — shared context
// ===========================================================================

/** Shared mutable state threaded between the three panel builder functions. */
interface SearchPanelContext {
  view: EditorView;
  searchInput: HTMLInputElement;
  replaceInput: HTMLInputElement;
  matchInfo: HTMLSpanElement;
  toggleCase?: HTMLButtonElement;
  toggleRegex?: HTMLButtonElement;
  toggleWord?: HTMLButtonElement;
  replaceRow?: HTMLDivElement;
  toggleReplaceBtn?: HTMLButtonElement;
  matchCache: SearchMatchCacheSnapshot | null;
  getToggles(): { caseSensitive: boolean; isRegexp: boolean; wholeWord: boolean };
  commitQuery(): void;
  updateMatchInfo(): void;
  syncPanelState(): void;
}

/** Reference-identity cache to avoid rescanning on every ViewUpdate. */
export interface SearchMatchCacheSnapshot {
  /** CM6 Text object from state.doc — used for reference equality. */
  readonly doc: object;
  readonly selFrom: number;
  readonly selTo: number;
  readonly query: SearchQuery;
  readonly current: number;
  readonly total: number;
  readonly ranges: readonly SearchMatchSpan[] | null;
}

function searchQueriesMatchEqual(left: SearchQuery, right: SearchQuery): boolean {
  return left.search === right.search &&
    left.caseSensitive === right.caseSensitive &&
    left.literal === right.literal &&
    left.regexp === right.regexp &&
    left.wholeWord === right.wholeWord &&
    left.test === right.test;
}

function updateMatchCache(
  view: EditorView,
  cache: SearchMatchCacheSnapshot | null,
): SearchMatchCacheSnapshot {
  const state = view.state;
  const q = getSearchQuery(state);
  const sel = state.selection.main;

  if (
    cache === null ||
    cache.doc !== state.doc ||
    !searchQueriesMatchEqual(cache.query, q)
  ) {
    const { current, total, ranges } = collectSearchMatchSummary(view);
    return {
      doc: state.doc,
      selFrom: sel.from,
      selTo: sel.to,
      query: q,
      current,
      total,
      ranges,
    };
  }

  if (cache.selFrom === sel.from && cache.selTo === sel.to) {
    return cache;
  }

  if (cache.ranges === null) {
    const { current, total, ranges } = collectSearchMatchSummary(view);
    return {
      ...cache,
      selFrom: sel.from,
      selTo: sel.to,
      current,
      total,
      ranges,
    };
  }

  return {
    ...cache,
    selFrom: sel.from,
    selTo: sel.to,
    current: findMatchOrdinal(cache.ranges, {
      from: sel.from,
      to: sel.to,
    }),
  };
}

export function _updateSearchMatchCacheForTest(
  view: EditorView,
  cache: SearchMatchCacheSnapshot | null,
): SearchMatchCacheSnapshot {
  return updateMatchCache(view, cache);
}

function getSearchPanelControls(ctx: SearchPanelContext): {
  toggleCase: HTMLButtonElement;
  toggleRegex: HTMLButtonElement;
  toggleWord: HTMLButtonElement;
  replaceRow: HTMLDivElement;
  toggleReplaceBtn: HTMLButtonElement;
} {
  const {
    toggleCase,
    toggleRegex,
    toggleWord,
    replaceRow,
    toggleReplaceBtn,
  } = ctx;
  if (!toggleCase || !toggleRegex || !toggleWord || !replaceRow || !toggleReplaceBtn) {
    throw new Error("[find-replace] search panel controls accessed before initialization");
  }
  return {
    toggleCase,
    toggleRegex,
    toggleWord,
    replaceRow,
    toggleReplaceBtn,
  };
}

// ===========================================================================
// Search row builder
// ===========================================================================

function createSearchInputRow(ctx: SearchPanelContext): HTMLDivElement {
  const { view, searchInput, matchInfo } = ctx;

  const searchRow = document.createElement("div");
  searchRow.className = CSS.searchRow;

  const { caseSensitive: initCase, isRegexp: initRegexp, wholeWord: initWord } = ctx.getToggles();
  const toggleCase = createToggle("Aa", "Match Case", initCase, (v) => {
    setSearchUiState(view, { caseSensitive: v });
    ctx.commitQuery();
  });
  const toggleRegex = createToggle(".*", "Use Regular Expression", initRegexp, (v) => {
    setSearchUiState(view, { isRegexp: v });
    ctx.commitQuery();
  });
  const toggleWord = createToggle("\\b", "Match Whole Word", initWord, (v) => {
    setSearchUiState(view, { wholeWord: v });
    ctx.commitQuery();
  });
  ctx.toggleCase = toggleCase;
  ctx.toggleRegex = toggleRegex;
  ctx.toggleWord = toggleWord;

  const toggleGroup = document.createElement("div");
  toggleGroup.className = CSS.searchToggles;
  toggleGroup.append(toggleCase, toggleRegex, toggleWord);

  const navGroup = document.createElement("div");
  navGroup.className = CSS.searchNav;
  navGroup.append(
    createAction("\u2191", "Previous Match (Shift+Enter)", () => previousSearchMatch(view)),
    createAction("\u2193", "Next Match (Enter)", () => nextSearchMatch(view)),
  );

  const closeBtn = createAction("\u00d7", "Close (Escape)", () => closeSearch(view));
  closeBtn.className = CSS.searchClose;

  const searchInputWrap = document.createElement("div");
  searchInputWrap.className = CSS.searchInputWrap;
  searchInputWrap.append(searchInput, matchInfo);

  searchRow.append(searchInputWrap, toggleGroup, navGroup, closeBtn);
  return searchRow;
}

// ===========================================================================
// Replace row builder
// ===========================================================================

function createReplaceRow(ctx: SearchPanelContext): HTMLDivElement {
  const { view } = ctx;

  const replaceRow = document.createElement("div") as HTMLDivElement;
  replaceRow.className = `${CSS.searchRow} ${CSS.searchReplaceRow}`;

  const replaceInputWrap = document.createElement("div");
  replaceInputWrap.className = CSS.searchInputWrap;
  replaceInputWrap.append(ctx.replaceInput);

  const replaceActions = document.createElement("div");
  replaceActions.className = CSS.searchReplaceActions;
  replaceActions.append(
    createAction("Replace", "Replace Current Match", () => {
      replaceCurrentSearchMatch(view);
      ctx.updateMatchInfo();
    }),
    createAction("All", "Replace All Matches", () => {
      replaceAllSearchMatches(view);
      ctx.updateMatchInfo();
    }),
  );

  replaceRow.append(replaceInputWrap, replaceActions);
  return replaceRow;
}

// ===========================================================================
// Event handler attachment
// ===========================================================================

function attachEventHandlers(ctx: SearchPanelContext): void {
  const { view, searchInput, replaceInput } = ctx;

  searchInput.addEventListener("input", () => {
    try {
      ctx.commitQuery();
    } catch (e: unknown) {
      console.error("[find-replace] search input handler failed", e);
    }
  });

  searchInput.addEventListener("keydown", (e) => {
    try {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          previousSearchMatch(view);
        } else {
          nextSearchMatch(view);
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeSearch(view);
        view.focus();
      }
    } catch (err: unknown) {
      console.error("[find-replace] search keydown handler failed", err);
    }
  });

  replaceInput.addEventListener("input", () => {
    try {
      ctx.commitQuery();
    } catch (e: unknown) {
      console.error("[find-replace] replace input handler failed", e);
    }
  });

  replaceInput.addEventListener("keydown", (e) => {
    try {
      if (e.key === "Enter") {
        e.preventDefault();
        replaceCurrentSearchMatch(view);
        ctx.updateMatchInfo();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeSearch(view);
        view.focus();
      }
    } catch (err: unknown) {
      console.error("[find-replace] replace keydown handler failed", err);
    }
  });
}

// ===========================================================================
// Custom search panel — context builder
// ===========================================================================

/** Build the SearchPanelContext with all cross-referencing methods. */
function buildSearchPanelContext(
  view: EditorView,
  searchInput: HTMLInputElement,
  replaceInput: HTMLInputElement,
  matchInfo: HTMLSpanElement,
): SearchPanelContext {
  const ctx: SearchPanelContext = {
    view,
    searchInput,
    replaceInput,
    matchInfo,
    matchCache: null,

    getToggles() {
      const ui = view.state.field(searchUiStateField);
      return { caseSensitive: ui.caseSensitive, isRegexp: ui.isRegexp, wholeWord: ui.wholeWord };
    },

    commitQuery() {
      const toggles = ctx.getToggles();
      setSearchControllerQuery(view, {
        search: searchInput.value,
        replace: replaceInput.value,
        caseSensitive: toggles.caseSensitive,
        regexp: toggles.isRegexp,
        wholeWord: toggles.wholeWord,
      });
    },

    updateMatchInfo() {
      // Recompute match ranges only when doc or query changes. Selection-only
      // updates use the cached sorted ranges to find the current ordinal.
      ctx.matchCache = updateMatchCache(view, ctx.matchCache);

      const { current, total } = ctx.matchCache;
      if (total === 0) {
        matchInfo.textContent = searchInput.value ? "No results" : "";
      } else {
        matchInfo.textContent = current > 0 ? `${current} of ${total}` : `${total} results`;
      }
    },

    syncPanelState() {
      const controls = getSearchPanelControls(ctx);
      // Read UI state directly via O(1) state field lookup instead of
      // getSearchControllerState which calls countSearchMatches (O(N)).
      const ui = view.state.field(searchUiStateField);
      const { caseSensitive, isRegexp, wholeWord } = ctx.getToggles();
      controls.toggleCase.classList.toggle(CSS.searchToggleActive, caseSensitive);
      controls.toggleCase.setAttribute("aria-pressed", String(caseSensitive));
      controls.toggleRegex.classList.toggle(CSS.searchToggleActive, isRegexp);
      controls.toggleRegex.setAttribute("aria-pressed", String(isRegexp));
      controls.toggleWord.classList.toggle(CSS.searchToggleActive, wholeWord);
      controls.toggleWord.setAttribute("aria-pressed", String(wholeWord));
      controls.replaceRow.style.display = ui.replaceVisible ? "" : "none";
      controls.toggleReplaceBtn.textContent = ui.replaceVisible ? "\u25be" : "\u25b8";
    },
  };
  return ctx;
}

// ===========================================================================
// Custom search panel — input element builder
// ===========================================================================

/** Create the search and replace inputs plus the match info span. */
function createSearchInputElements(): {
  searchInput: HTMLInputElement;
  replaceInput: HTMLInputElement;
  matchInfo: HTMLSpanElement;
} {
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = CSS.searchInput;
  searchInput.placeholder = "Find";
  searchInput.setAttribute("main-field", "true");
  searchInput.setAttribute("aria-label", "Find");

  const replaceInput = document.createElement("input");
  replaceInput.type = "text";
  replaceInput.className = CSS.searchInput;
  replaceInput.placeholder = "Replace";
  replaceInput.setAttribute("aria-label", "Replace");

  const matchInfo = document.createElement("span");
  matchInfo.className = CSS.searchMatchInfo;
  matchInfo.textContent = "No results";

  return { searchInput, replaceInput, matchInfo };
}

// ===========================================================================
// Custom search panel — DOM assembly
// ===========================================================================

/** Create and assemble all panel DOM elements. Returns the root dom element. */
function assembleSearchPanelDom(ctx: SearchPanelContext): HTMLDivElement {
  const { view, replaceInput } = ctx;

  const dom = document.createElement("div");
  dom.className = CSS.searchPanel;

  const searchRow = createSearchInputRow(ctx);
  const replaceRow = createReplaceRow(ctx);
  ctx.replaceRow = replaceRow;

  const toggleReplaceBtn = createAction("\u25b8", "Toggle Replace", () => {
    // Read UI state directly via O(1) state field lookup instead of
    // getSearchControllerState which calls countSearchMatches (O(N)).
    const ui = view.state.field(searchUiStateField);
    const replaceVisible = !ui.replaceVisible;
    setSearchUiState(view, { replaceVisible });
    ctx.syncPanelState();
    if (replaceVisible) replaceInput.focus();
  });
  toggleReplaceBtn.className = CSS.searchToggleReplace;
  ctx.toggleReplaceBtn = toggleReplaceBtn;

  dom.append(toggleReplaceBtn, searchRow, replaceRow);
  return dom;
}

// ===========================================================================
// Custom search panel — Panel callbacks
// ===========================================================================

/** Build the Panel mount/update callbacks for a fully assembled context. */
function buildPanelCallbacks(
  ctx: SearchPanelContext,
): Pick<Panel, "mount" | "update"> {
  const { searchInput, replaceInput } = ctx;

  return {
    mount() {
      searchInput.focus();
      searchInput.select();
      ctx.updateMatchInfo();
    },

    update(update: ViewUpdate) {
      // Read query and UI state directly via O(1) state field lookups
      // instead of getSearchControllerState which calls countSearchMatches (O(N)).
      const { replaceRow } = getSearchPanelControls(ctx);
      const q = getSearchQuery(update.state);
      if (q.search !== searchInput.value) searchInput.value = q.search;
      if (q.replace !== replaceInput.value) replaceInput.value = q.replace;

      const ui = update.state.field(searchUiStateField);
      const { caseSensitive, isRegexp, wholeWord } = ctx.getToggles();
      if (
        q.caseSensitive !== caseSensitive ||
        q.regexp !== isRegexp ||
        q.wholeWord !== wholeWord ||
        ui.replaceVisible !== (replaceRow.style.display !== "none")
      ) {
        ctx.syncPanelState();
      }

      ctx.updateMatchInfo();
    },
  };
}

// ===========================================================================
// Custom search panel — orchestrator
// ===========================================================================

function createSearchPanel(view: EditorView): Panel {
  const { searchInput, replaceInput, matchInfo } = createSearchInputElements();
  const ctx = buildSearchPanelContext(view, searchInput, replaceInput, matchInfo);
  const dom = assembleSearchPanelDom(ctx);

  ctx.syncPanelState();
  attachEventHandlers(ctx);

  // Populate from existing query if reopening.
  // Read query directly via O(1) state field lookup instead of
  // getSearchControllerState which calls countSearchMatches (O(N)).
  const existingQuery = getSearchQuery(view.state);
  if (existingQuery.valid) {
    searchInput.value = existingQuery.search;
    replaceInput.value = existingQuery.replace;
    ctx.syncPanelState();
  }

  return { dom, top: true, ...buildPanelCallbacks(ctx) };
}

// ===========================================================================
// Helpers for syncing replace row when re-invoking Cmd+F / Cmd+H
// ===========================================================================

/** Update the replace row and toggle button in an already-open panel. */
function syncReplaceRow(view: EditorView): void {
  const replaceRow = view.dom.querySelector<HTMLElement>(`.${CSS.searchReplaceRow}`);
  const toggleBtn = view.dom.querySelector<HTMLElement>(`.${CSS.searchToggleReplace}`);
  // Read UI state directly via O(1) state field lookup instead of
  // getSearchControllerState which calls countSearchMatches (O(N)).
  const ui = view.state.field(searchUiStateField);
  if (replaceRow) {
    replaceRow.style.display = ui.replaceVisible ? "" : "none";
  }
  if (toggleBtn) {
    toggleBtn.textContent = ui.replaceVisible ? "\u25be" : "\u25b8";
  }
}

// ===========================================================================
// Open commands
// ===========================================================================

/** Open the search panel in find-only mode (Cmd+F). */
function openFindPanel(view: EditorView): boolean {
  openFindSearch(view);
  // If panel was already open, sync the replace row visibility
  syncReplaceRow(view);
  return true;
}

/** Open the search panel with replace row visible (Cmd+H). */
function openFindReplacePanel(view: EditorView): boolean {
  openReplaceSearch(view);
  // Sync visibility + focus replace input after panel renders
  syncReplaceRow(view);
  requestAnimationFrame(() => {
    const replaceField = view.dom.querySelector<HTMLInputElement>(
      `.${CSS.searchReplaceRow} .${CSS.searchInput}`,
    );
    replaceField?.focus();
    replaceField?.select();
  });
  return true;
}

// ===========================================================================
// Extension
// ===========================================================================

/**
 * CodeMirror search extension with Coflat-native panel.
 *
 * - Cmd+F: open find panel
 * - Cmd+H: open find-and-replace panel
 * - Enter / Shift+Enter: next / previous match
 * - Escape: close panel
 */
export const findReplaceExtension: Extension = [
  searchControllerExtensions,
  search({ top: true, createPanel: createSearchPanel }),
  keymap.of([
    { key: "Mod-f", run: openFindPanel, preventDefault: true },
    { key: "Mod-h", run: openFindReplacePanel, preventDefault: true },
    ...searchKeymap.filter(
      (b) => b.key !== "Mod-f" && b.key !== "Mod-h",
    ),
  ]),
];
