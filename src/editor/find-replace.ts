/**
 * Coflat-native search panel for in-document find & replace.
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
  SearchQuery,
  searchKeymap,
  setSearchQuery,
} from "@codemirror/search";
import { type Extension } from "@codemirror/state";
import {
  type EditorView,
  type Panel,
  type ViewUpdate,
  keymap,
} from "@codemirror/view";

// ---------------------------------------------------------------------------
// Match counting
// ---------------------------------------------------------------------------

/** Count total matches and the 1-based index of the current selection match. */
function countMatches(
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

// ---------------------------------------------------------------------------
// Toggle button helper
// ---------------------------------------------------------------------------

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
  btn.className = "cf-search-toggle";
  btn.setAttribute("aria-pressed", String(initialActive));
  if (initialActive) btn.classList.add("cf-search-toggle-active");

  btn.addEventListener("mousedown", (e) => {
    e.preventDefault(); // Prevent focus steal
  });
  btn.addEventListener("click", () => {
    const next = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", String(next));
    btn.classList.toggle("cf-search-toggle-active", next);
    onChange(next);
  });
  return btn;
}

// ---------------------------------------------------------------------------
// Action button helper
// ---------------------------------------------------------------------------

function createAction(
  label: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.title = title;
  btn.className = "cf-search-action";
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", onClick);
  return btn;
}

// ---------------------------------------------------------------------------
// Custom search panel
// ---------------------------------------------------------------------------

/** Whether to show the replace row. Set by Cmd+H vs Cmd+F. */
let showReplace = false;

function createSearchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cf-search-panel";

  // ── Search row ──────────────────────────────────────────────────────────

  const searchRow = document.createElement("div");
  searchRow.className = "cf-search-row";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "cf-search-input";
  searchInput.placeholder = "Find";
  searchInput.setAttribute("main-field", "true");
  searchInput.setAttribute("aria-label", "Find");

  const matchInfo = document.createElement("span");
  matchInfo.className = "cf-search-match-info";
  matchInfo.textContent = "No results";

  // Toggles
  let caseSensitive = false;
  let isRegexp = false;
  let wholeWord = false;

  function commitQuery(): void {
    const query = new SearchQuery({
      search: searchInput.value,
      caseSensitive,
      regexp: isRegexp,
      wholeWord,
      replace: replaceInput.value,
    });
    view.dispatch({ effects: setSearchQuery.of(query) });
  }

  function updateMatchInfo(): void {
    const { current, total } = countMatches(view);
    if (total === 0) {
      matchInfo.textContent = searchInput.value ? "No results" : "";
    } else {
      matchInfo.textContent = current > 0 ? `${current} of ${total}` : `${total} results`;
    }
  }

  /** Sync toggle button DOM to match the given query's options. */
  function syncToggles(q: SearchQuery): void {
    caseSensitive = q.caseSensitive;
    isRegexp = q.regexp;
    wholeWord = q.wholeWord;
    toggleCase.classList.toggle("cf-search-toggle-active", caseSensitive);
    toggleCase.setAttribute("aria-pressed", String(caseSensitive));
    toggleRegex.classList.toggle("cf-search-toggle-active", isRegexp);
    toggleRegex.setAttribute("aria-pressed", String(isRegexp));
    toggleWord.classList.toggle("cf-search-toggle-active", wholeWord);
    toggleWord.setAttribute("aria-pressed", String(wholeWord));
  }

  const toggleCase = createToggle("Aa", "Match Case", caseSensitive, (v) => {
    caseSensitive = v;
    commitQuery();
  });
  const toggleRegex = createToggle(".*", "Use Regular Expression", isRegexp, (v) => {
    isRegexp = v;
    commitQuery();
  });
  const toggleWord = createToggle("\\b", "Match Whole Word", wholeWord, (v) => {
    wholeWord = v;
    commitQuery();
  });

  const toggleGroup = document.createElement("div");
  toggleGroup.className = "cf-search-toggles";
  toggleGroup.append(toggleCase, toggleRegex, toggleWord);

  const navGroup = document.createElement("div");
  navGroup.className = "cf-search-nav";
  navGroup.append(
    createAction("\u2191", "Previous Match (Shift+Enter)", () => findPrevious(view)),
    createAction("\u2193", "Next Match (Enter)", () => findNext(view)),
  );

  const closeBtn = createAction("\u00d7", "Close (Escape)", () => closeSearchPanel(view));
  closeBtn.className = "cf-search-close";

  const searchInputWrap = document.createElement("div");
  searchInputWrap.className = "cf-search-input-wrap";
  searchInputWrap.append(searchInput, matchInfo);

  searchRow.append(searchInputWrap, toggleGroup, navGroup, closeBtn);

  // ── Replace row ─────────────────────────────────────────────────────────

  const replaceRow = document.createElement("div");
  replaceRow.className = "cf-search-row cf-replace-row";

  const replaceInput = document.createElement("input");
  replaceInput.type = "text";
  replaceInput.className = "cf-search-input";
  replaceInput.placeholder = "Replace";
  replaceInput.setAttribute("aria-label", "Replace");

  const replaceInputWrap = document.createElement("div");
  replaceInputWrap.className = "cf-search-input-wrap";
  replaceInputWrap.append(replaceInput);

  const replaceActions = document.createElement("div");
  replaceActions.className = "cf-search-replace-actions";
  replaceActions.append(
    createAction("Replace", "Replace Current Match", () => {
      replaceNext(view);
      updateMatchInfo();
    }),
    createAction("All", "Replace All Matches", () => {
      replaceAll(view);
      updateMatchInfo();
    }),
  );

  replaceRow.append(replaceInputWrap, replaceActions);

  // Toggle replace row visibility
  function syncReplaceVisibility(): void {
    replaceRow.style.display = showReplace ? "" : "none";
  }

  const toggleReplaceBtn = createAction("\u25b8", "Toggle Replace", () => {
    showReplace = !showReplace;
    syncReplaceVisibility();
    toggleReplaceBtn.textContent = showReplace ? "\u25be" : "\u25b8";
    if (showReplace) {
      replaceInput.focus();
    }
  });
  toggleReplaceBtn.className = "cf-search-toggle-replace";
  toggleReplaceBtn.textContent = showReplace ? "\u25be" : "\u25b8";

  // ── Assemble ────────────────────────────────────────────────────────────

  dom.append(toggleReplaceBtn, searchRow, replaceRow);
  syncReplaceVisibility();

  // ── Events ──────────────────────────────────────────────────────────────

  searchInput.addEventListener("input", () => {
    commitQuery();
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        findPrevious(view);
      } else {
        findNext(view);
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  });

  replaceInput.addEventListener("input", () => {
    commitQuery();
  });

  replaceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      replaceNext(view);
      updateMatchInfo();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  });

  // Populate from existing query if reopening
  const existing = getSearchQuery(view.state);
  if (existing.valid) {
    searchInput.value = existing.search;
    replaceInput.value = existing.replace;
    syncToggles(existing);
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
      const q = getSearchQuery(update.state);
      if (q.search !== searchInput.value) {
        searchInput.value = q.search;
      }
      if (q.replace !== replaceInput.value) {
        replaceInput.value = q.replace;
      }
      if (
        q.caseSensitive !== caseSensitive ||
        q.regexp !== isRegexp ||
        q.wholeWord !== wholeWord
      ) {
        syncToggles(q);
      }

      // Update match count on query, doc, or selection changes
      if (
        update.docChanged ||
        update.selectionSet ||
        update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(setSearchQuery)),
        )
      ) {
        updateMatchInfo();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers for syncing replace row when re-invoking Cmd+F / Cmd+H
// ---------------------------------------------------------------------------

/** Update the replace row and toggle button in an already-open panel. */
function syncReplaceRow(view: EditorView): void {
  const replaceRow = view.dom.querySelector<HTMLElement>(".cf-replace-row");
  const toggleBtn = view.dom.querySelector<HTMLElement>(".cf-search-toggle-replace");
  if (replaceRow) {
    replaceRow.style.display = showReplace ? "" : "none";
  }
  if (toggleBtn) {
    toggleBtn.textContent = showReplace ? "\u25be" : "\u25b8";
  }
}

// ---------------------------------------------------------------------------
// Open commands
// ---------------------------------------------------------------------------

/** Open the search panel in find-only mode (Cmd+F). */
function openFindPanel(view: EditorView): boolean {
  showReplace = false;
  openSearchPanel(view);
  // If panel was already open, sync the replace row visibility
  syncReplaceRow(view);
  return true;
}

/** Open the search panel with replace row visible (Cmd+H). */
function openFindReplacePanel(view: EditorView): boolean {
  showReplace = true;
  openSearchPanel(view);
  // Sync visibility + focus replace input after panel renders
  syncReplaceRow(view);
  requestAnimationFrame(() => {
    const replaceField = view.dom.querySelector<HTMLInputElement>(
      ".cf-replace-row .cf-search-input",
    );
    replaceField?.focus();
    replaceField?.select();
  });
  return true;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

/**
 * CodeMirror search extension with Coflat-native panel.
 *
 * - Cmd+F: open find panel
 * - Cmd+H: open find-and-replace panel
 * - Enter / Shift+Enter: next / previous match
 * - Escape: close panel
 */
export const findReplaceExtension: Extension = [
  search({ top: true, createPanel: createSearchPanel }),
  keymap.of([
    ...searchKeymap,
    { key: "Mod-f", run: openFindPanel, preventDefault: true },
    { key: "Mod-h", run: openFindReplacePanel, preventDefault: true },
  ]),
];
