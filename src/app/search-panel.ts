/**
 * Semantic search panel for querying the document index.
 *
 * Provides a search UI with text input and block-type filter controls.
 * Queries the indexer for full-text, label, math, and type-filtered
 * search, displaying results with type, number, title, and file location.
 * Clicking a result navigates to that block in the editor.
 */

import type { BackgroundIndexer } from "../index";
import type { IndexEntry, IndexQuery } from "../index";

/** Known block types available for filtering. */
const BLOCK_TYPES = [
  "theorem",
  "lemma",
  "corollary",
  "proposition",
  "conjecture",
  "definition",
  "proof",
  "remark",
  "example",
  "algorithm",
  "equation",
  "heading",
] as const;

/** Callback when a search result is selected. */
export type SearchResultHandler = (entry: IndexEntry) => void;

/**
 * Semantic search panel component.
 *
 * Mounts as an overlay panel with a search input, block-type filter,
 * and scrollable results list. Queries a DocumentIndex and invokes
 * a result handler when a result is clicked.
 */
export class SearchPanel {
  readonly element: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly typeSelect: HTMLSelectElement;
  private readonly resultsList: HTMLElement;
  private readonly statusEl: HTMLElement;

  private indexer: BackgroundIndexer | null = null;
  private onResult: SearchResultHandler | null = null;
  private visible = false;
  private lastResultCount = 0;

  constructor() {
    // Backdrop covers the page behind the panel
    this.backdrop = document.createElement("div");
    this.backdrop.className = "search-backdrop";
    this.backdrop.addEventListener("click", () => this.hide());

    // Panel container
    this.panel = document.createElement("div");
    this.panel.className = "search-panel";

    // Header row with input and filter
    const header = document.createElement("div");
    header.className = "search-header";

    this.input = document.createElement("input");
    this.input.className = "search-input";
    this.input.type = "text";
    this.input.placeholder = "Search blocks, labels, math...";
    this.input.addEventListener("input", () => this.executeSearch());
    header.appendChild(this.input);

    this.typeSelect = document.createElement("select");
    this.typeSelect.className = "search-type-filter";
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All types";
    this.typeSelect.appendChild(allOption);
    for (const t of BLOCK_TYPES) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      this.typeSelect.appendChild(opt);
    }
    this.typeSelect.addEventListener("change", () => this.executeSearch());
    header.appendChild(this.typeSelect);

    this.panel.appendChild(header);

    // Results list
    this.resultsList = document.createElement("div");
    this.resultsList.className = "search-results";
    this.panel.appendChild(this.resultsList);

    // Status line
    this.statusEl = document.createElement("div");
    this.statusEl.className = "search-status";
    this.statusEl.textContent = "Type to search";
    this.panel.appendChild(this.statusEl);

    // Outer element holds both backdrop and panel
    this.element = document.createElement("div");
    this.element.className = "search-overlay";
    this.element.style.display = "none";
    this.element.appendChild(this.backdrop);
    this.element.appendChild(this.panel);

    // Keyboard handling on the panel
    this.panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.hide();
      }
    });
  }

  /** Set the background indexer to query against. */
  setIndexer(indexer: BackgroundIndexer): void {
    this.indexer = indexer;
    if (this.visible) {
      this.executeSearch();
    }
  }

  /** Set the handler called when a result is clicked. */
  setResultHandler(handler: SearchResultHandler): void {
    this.onResult = handler;
  }

  /** Show the search panel and focus the input. */
  show(): void {
    this.visible = true;
    this.element.style.display = "";
    this.input.focus();
    this.executeSearch();
  }

  /** Hide the search panel and clear state. */
  hide(): void {
    this.visible = false;
    this.element.style.display = "none";
  }

  /** Whether the panel is currently visible. */
  isVisible(): boolean {
    return this.visible;
  }

  /** Toggle panel visibility. */
  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /** Get the current search query text (for testing). */
  getQuery(): string {
    return this.input.value;
  }

  /** Set the search query text programmatically (for testing). */
  setQuery(text: string): void {
    this.input.value = text;
    this.executeSearch();
  }

  /** Get the current type filter value (for testing). */
  getTypeFilter(): string {
    return this.typeSelect.value;
  }

  /** Get the number of results from the last search (for testing). */
  getResultCount(): number {
    return this.lastResultCount;
  }

  /** Set the type filter programmatically (for testing). */
  setTypeFilter(type: string): void {
    this.typeSelect.value = type;
    this.executeSearch();
  }

  /** Execute the search with current input values and render results. */
  private executeSearch(): void {
    const text = this.input.value.trim();
    const type = this.typeSelect.value || undefined;

    if (!this.indexer) {
      this.renderResults([]);
      return;
    }

    const query = this.buildQuery(text, type);
    this.indexer.query(query).then(
      (results) => this.renderResults(results),
      () => this.renderResults([]),
    );
  }

  /** Build an IndexQuery from the raw search text and optional type filter. */
  private buildQuery(text: string, type: string | undefined): IndexQuery {
    // Detect label search: text starting with # or containing : like eq:foo
    const isLabel = text.startsWith("#") || /^[a-z]+-?\w*:\w/i.test(text);

    if (isLabel) {
      const label = text.startsWith("#") ? text.slice(1) : text;
      return { type, label };
    }

    // Full-text and math content search
    return { type, content: text || undefined };
  }

  /** Render the results list from index entries. */
  private renderResults(results: readonly IndexEntry[]): void {
    this.lastResultCount = results.length;
    this.resultsList.innerHTML = "";

    if (results.length === 0) {
      const text = this.input.value.trim();
      this.statusEl.textContent = text ? "No results found" : "Type to search";
      return;
    }

    this.statusEl.textContent = `${results.length} result${results.length === 1 ? "" : "s"}`;

    for (const entry of results) {
      const item = document.createElement("div");
      item.className = "search-result-item";

      const typeBadge = document.createElement("span");
      typeBadge.className = "search-result-type";
      typeBadge.textContent = entry.type;
      item.appendChild(typeBadge);

      if (entry.number !== undefined) {
        const numSpan = document.createElement("span");
        numSpan.className = "search-result-number";
        numSpan.textContent = String(entry.number);
        item.appendChild(numSpan);
      }

      if (entry.title) {
        const titleSpan = document.createElement("span");
        titleSpan.className = "search-result-title";
        titleSpan.textContent = entry.title;
        item.appendChild(titleSpan);
      }

      const fileSpan = document.createElement("span");
      fileSpan.className = "search-result-file";
      fileSpan.textContent = entry.file;
      item.appendChild(fileSpan);

      item.addEventListener("click", () => {
        this.onResult?.(entry);
        this.hide();
      });

      this.resultsList.appendChild(item);
    }
  }
}

/**
 * Install a keyboard shortcut to toggle the search panel.
 *
 * Binds Cmd/Ctrl+Shift+F to toggle the panel.
 * Returns a cleanup function that removes the listener.
 */
export function installSearchKeybinding(
  root: HTMLElement,
  panel: SearchPanel,
): () => void {
  const handler = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "F") {
      e.preventDefault();
      panel.toggle();
    }
  };
  root.addEventListener("keydown", handler);
  return () => root.removeEventListener("keydown", handler);
}
