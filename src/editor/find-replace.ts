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
  search,
  searchKeymap,
  searchPanelOpen,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  type EditorView,
  type Panel,
  type ViewUpdate,
  keymap,
} from "@codemirror/view";
import { SEARCH_CONTEXT_BUFFER, CSS } from "../constants";

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

export interface SearchMatchRange {
  readonly from: number;
  readonly to: number;
}

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
  const query = getSearchQuery(view.state);
  if (!query.valid) return { current: 0, total: 0 };

  const cursor = query.getCursor(view.state);
  const sel = view.state.selection.main;
  let total = 0;
  let current = 0;

  for (let result = cursor.next(); !result.done; result = cursor.next()) {
    total++;
    if (result.value.from === sel.from && result.value.to === sel.to) {
      current = total;
    }
  }

  return { current, total };
}

export function collectVisibleSearchMatches(view: EditorView): SearchMatchRange[] {
  if (!searchPanelOpen(view.state)) return [];

  const spec = getSearchQuery(view.state);
  if (!spec.valid) return [];

  const matches: SearchMatchRange[] = [];
  for (const { from, to } of view.visibleRanges) {
    const searchFrom = Math.max(0, from - SEARCH_CONTEXT_BUFFER);
    const searchTo = Math.min(view.state.doc.length, to + SEARCH_CONTEXT_BUFFER);
    const cursor = spec.getCursor(view.state.doc, searchFrom, searchTo);
    for (let result = cursor.next(); !result.done; result = cursor.next()) {
      matches.push({ from: result.value.from, to: result.value.to });
    }
  }
  return matches;
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
  title: string,
  initialActive: boolean,
  onChange: (active: boolean) => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.title = title;
  btn.className = CSS.searchToggle;
  btn.setAttribute("aria-pressed", String(initialActive));
  if (initialActive) btn.classList.add(CSS.searchToggleActive);

  btn.addEventListener("mousedown", (e) => {
    e.preventDefault(); // Prevent focus steal
  });
  btn.addEventListener("click", () => {
    const next = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", String(next));
    btn.classList.toggle(CSS.searchToggleActive, next);
    onChange(next);
  });
  return btn;
}

// ===========================================================================
// Action button helper
// ===========================================================================

function createAction(
  label: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.title = title;
  btn.className = CSS.searchAction;
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", onClick);
  return btn;
}

// ===========================================================================
// Custom search panel
// ===========================================================================

function createSearchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = CSS.searchPanel;

  // -- Search row -----------------------------------------------------------

  const searchRow = document.createElement("div");
  searchRow.className = CSS.searchRow;

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = CSS.searchInput;
  searchInput.placeholder = "Find";
  searchInput.setAttribute("main-field", "true");
  searchInput.setAttribute("aria-label", "Find");

  const matchInfo = document.createElement("span");
  matchInfo.className = CSS.searchMatchInfo;
  matchInfo.textContent = "No results";

  // Toggle state is read from and written to searchUiStateField so it
  // persists across panel close/reopen within the same editor session.
  function getToggles(): { caseSensitive: boolean; isRegexp: boolean; wholeWord: boolean } {
    const ui = view.state.field(searchUiStateField);
    return { caseSensitive: ui.caseSensitive, isRegexp: ui.isRegexp, wholeWord: ui.wholeWord };
  }

  function commitQuery(): void {
    const toggles = getToggles();
    setSearchControllerQuery(view, {
      search: searchInput.value,
      replace: replaceInput.value,
      caseSensitive: toggles.caseSensitive,
      regexp: toggles.isRegexp,
      wholeWord: toggles.wholeWord,
    });
  }

  // Cache the last match counts to avoid re-scanning the full document on
  // every ViewUpdate (e.g. cursor moves that don't change search results).
  // We recompute only when the doc identity, selection, or query changes.
  interface MatchCache {
    /** Reference-identity key: the CM6 Text object from state.doc. */
    doc: object;
    selFrom: number;
    selTo: number;
    queryKey: string;
    current: number;
    total: number;
  }
  let matchCache: MatchCache | null = null;

  function serializeQuery(q: ReturnType<typeof getSearchQuery>): string {
    if (!q.valid) return "";
    return `${q.search}\0${String(q.caseSensitive)}\0${String(q.regexp)}\0${String(q.wholeWord)}`;
  }

  function updateMatchInfo(): void {
    const state = view.state;
    const q = getSearchQuery(state);
    const sel = state.selection.main;
    const queryKey = serializeQuery(q);

    // Check cache validity — only recount when something material changed.
    if (
      matchCache === null ||
      matchCache.doc !== state.doc ||
      matchCache.selFrom !== sel.from ||
      matchCache.selTo !== sel.to ||
      matchCache.queryKey !== queryKey
    ) {
      const { current, total } = countSearchMatches(view);
      matchCache = { doc: state.doc, selFrom: sel.from, selTo: sel.to, queryKey, current, total };
    }

    const { current, total } = matchCache;
    if (total === 0) {
      matchInfo.textContent = searchInput.value ? "No results" : "";
    } else {
      matchInfo.textContent =
        current > 0 ? `${current} of ${total}` : `${total} results`;
    }
  }

  /** Sync toggle button DOM from searchUiStateField and the CM6 query. */
  function syncPanelState(): void {
    const state = getSearchControllerState(view);
    const { caseSensitive, isRegexp, wholeWord } = getToggles();
    toggleCase.classList.toggle(CSS.searchToggleActive, caseSensitive);
    toggleCase.setAttribute("aria-pressed", String(caseSensitive));
    toggleRegex.classList.toggle(CSS.searchToggleActive, isRegexp);
    toggleRegex.setAttribute("aria-pressed", String(isRegexp));
    toggleWord.classList.toggle(CSS.searchToggleActive, wholeWord);
    toggleWord.setAttribute("aria-pressed", String(wholeWord));
    replaceRow.style.display = state.replaceVisible ? "" : "none";
    toggleReplaceBtn.textContent = state.replaceVisible ? "\u25be" : "\u25b8";
  }

  const { caseSensitive: initCase, isRegexp: initRegexp, wholeWord: initWord } = getToggles();
  const toggleCase = createToggle("Aa", "Match Case", initCase, (v) => {
    setSearchUiState(view, { caseSensitive: v });
    commitQuery();
  });
  const toggleRegex = createToggle(".*", "Use Regular Expression", initRegexp, (v) => {
    setSearchUiState(view, { isRegexp: v });
    commitQuery();
  });
  const toggleWord = createToggle("\\b", "Match Whole Word", initWord, (v) => {
    setSearchUiState(view, { wholeWord: v });
    commitQuery();
  });

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

  // -- Replace row ----------------------------------------------------------

  const replaceRow = document.createElement("div");
  replaceRow.className = `${CSS.searchRow} ${CSS.searchReplaceRow}`;

  const replaceInput = document.createElement("input");
  replaceInput.type = "text";
  replaceInput.className = CSS.searchInput;
  replaceInput.placeholder = "Replace";
  replaceInput.setAttribute("aria-label", "Replace");

  const replaceInputWrap = document.createElement("div");
  replaceInputWrap.className = CSS.searchInputWrap;
  replaceInputWrap.append(replaceInput);

  const replaceActions = document.createElement("div");
  replaceActions.className = CSS.searchReplaceActions;
  replaceActions.append(
    createAction("Replace", "Replace Current Match", () => {
      replaceCurrentSearchMatch(view);
      updateMatchInfo();
    }),
    createAction("All", "Replace All Matches", () => {
      replaceAllSearchMatches(view);
      updateMatchInfo();
    }),
  );

  replaceRow.append(replaceInputWrap, replaceActions);

  const toggleReplaceBtn = createAction("\u25b8", "Toggle Replace", () => {
    const state = getSearchControllerState(view);
    const replaceVisible = !state.replaceVisible;
    setSearchUiState(view, { replaceVisible });
    syncPanelState();
    if (replaceVisible) {
      replaceInput.focus();
    }
  });
  toggleReplaceBtn.className = CSS.searchToggleReplace;
  toggleReplaceBtn.textContent = "\u25b8";

  // -- Assemble -------------------------------------------------------------

  dom.append(toggleReplaceBtn, searchRow, replaceRow);
  syncPanelState();

  // -- Events ---------------------------------------------------------------

  searchInput.addEventListener("input", () => {
    commitQuery();
  });

  searchInput.addEventListener("keydown", (e) => {
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
  });

  replaceInput.addEventListener("input", () => {
    commitQuery();
  });

  replaceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      replaceCurrentSearchMatch(view);
      updateMatchInfo();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearch(view);
      view.focus();
    }
  });

  // Populate from existing query if reopening
  const existing = getSearchControllerState(view);
  if (existing.query.valid) {
    searchInput.value = existing.query.search;
    replaceInput.value = existing.query.replace;
    syncPanelState();
  }

  return {
    dom,
    top: true,

    mount() {
      searchInput.focus();
      searchInput.select();
      updateMatchInfo();
    },

    update(update: ViewUpdate) {
      // React to external query changes (e.g. from select-next-occurrence)
      const state = getSearchControllerState(update.view);
      const q = state.query;
      if (q.search !== searchInput.value) {
        searchInput.value = q.search;
      }
      if (q.replace !== replaceInput.value) {
        replaceInput.value = q.replace;
      }
      const { caseSensitive, isRegexp, wholeWord } = getToggles();
      if (
        q.caseSensitive !== caseSensitive ||
        q.regexp !== isRegexp ||
        q.wholeWord !== wholeWord ||
        state.replaceVisible !== (replaceRow.style.display !== "none")
      ) {
        syncPanelState();
      }

      updateMatchInfo();
    },
  };
}

// ===========================================================================
// Helpers for syncing replace row when re-invoking Cmd+F / Cmd+H
// ===========================================================================

/** Update the replace row and toggle button in an already-open panel. */
function syncReplaceRow(view: EditorView): void {
  const replaceRow = view.dom.querySelector<HTMLElement>(`.${CSS.searchReplaceRow}`);
  const toggleBtn = view.dom.querySelector<HTMLElement>(`.${CSS.searchToggleReplace}`);
  const state = getSearchControllerState(view);
  if (replaceRow) {
    replaceRow.style.display = state.replaceVisible ? "" : "none";
  }
  if (toggleBtn) {
    toggleBtn.textContent = state.replaceVisible ? "\u25be" : "\u25b8";
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
