/**
 * React search panel for querying the semantic document index.
 *
 * Provides a modal overlay with a text input and block-type filter.
 * Results are grouped by file with type badge, number, title, and
 * a content preview. Cmd/Ctrl+Shift+F toggles the panel.
 */

import { memo } from "react";
import { Search } from "lucide-react";
import type { IndexEntry } from "../../index/query-api";
import { basename } from "../lib/utils";
import type { AppSearchMode } from "../search";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { BLOCK_MANIFEST_ENTRIES } from "../../constants/block-manifest";
import type { SearchPanelControllerState } from "../hooks/use-search-panel-controller";

/**
 * Block types for the search filter dropdown.
 *
 * Standard block types are derived from BLOCK_MANIFEST (excluding blockquote,
 * which is not indexed as a semantic block). "equation" and "heading" are
 * search-only index types not in the manifest.
 */
const BLOCK_TYPES: readonly string[] = [
  ...BLOCK_MANIFEST_ENTRIES
    .filter((e) => e.specialBehavior !== "blockquote")
    .map((e) => e.name),
  "equation",
  "heading",
];

const ALL_TYPES_VALUE = "__all__";

export interface SearchPanelProps {
  /** Whether the panel is visible. */
  open: boolean;
  /** Called to open or close the panel. */
  onOpenChange: (open: boolean) => void;
  /** Called when the user clicks a result. */
  onResultSelect: (entry: IndexEntry) => void;
  /** Whether the app-level search is semantic or raw source text. */
  searchMode: AppSearchMode;
  /** Controller-owned search state. */
  state: SearchPanelControllerState;
  /** Called when the search query changes. */
  onQueryChange: (query: string) => void;
  /** Called when the block-type filter changes. */
  onTypeFilterChange: (typeFilter: string) => void;
}

/** Group results by file path. */
function groupByFile(entries: readonly IndexEntry[]): Map<string, IndexEntry[]> {
  const groups = new Map<string, IndexEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.file) ?? [];
    group.push(entry);
    groups.set(entry.file, group);
  }
  return groups;
}

/** Truncate content preview to a reasonable length. */
function previewContent(content: string, maxLen = 80): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) + "…" : trimmed;
}

// ── SearchResultItem ──────────────────────────────────────────────────────────

interface SearchResultItemProps {
  entry: IndexEntry;
  onClick: (entry: IndexEntry) => void;
}

/** Single search result row: type badge, number, title, label, and content preview. */
export const SearchResultItem = memo(function SearchResultItem({
  entry,
  onClick,
}: SearchResultItemProps) {
  return (
    <button
      className="w-full text-left px-3 py-2 flex flex-col gap-0.5 hover:bg-[var(--cf-hover)] border-b border-[var(--cf-border)] last:border-b-0 transition-colors duration-[var(--cf-transition,0.15s)]"
      onClick={() => onClick(entry)}
    >
      {/* Top row: type badge + number + title */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded bg-[var(--cf-subtle)] text-[var(--cf-muted)]">
          {entry.type}
        </span>
        {entry.number !== undefined && (
          <span className="shrink-0 text-xs text-[var(--cf-muted)] font-mono">
            {entry.number}
          </span>
        )}
        {entry.title && (
          <span className="truncate text-sm text-[var(--cf-fg)] font-medium">
            {entry.title}
          </span>
        )}
        {entry.label && (
          <span className="ml-auto shrink-0 text-[10px] font-mono text-[var(--cf-muted)]">
            #{entry.label}
          </span>
        )}
      </div>

      {/* Content preview */}
      {entry.content && (
        <span className="text-xs text-[var(--cf-muted)] truncate">
          {previewContent(entry.content)}
        </span>
      )}
    </button>
  );
});

// ── SearchPanel ───────────────────────────────────────────────────────────────

/**
 * Modal search panel view. Results are grouped by file and rendered from the
 * controller-owned search state passed in via props.
 */
export function SearchPanel({
  open,
  onOpenChange,
  onResultSelect,
  searchMode,
  state,
  onQueryChange,
  onTypeFilterChange,
}: SearchPanelProps) {
  if (!open) return null;

  const { query, typeFilter, results, hasMore, searching } = state;
  const grouped = groupByFile(results);
  const text = query.trim();
  let statusText: string;
  if (searching) {
    statusText = "Searching…";
  } else if (results.length === 0) {
    statusText = text || typeFilter ? "No results found" : "Type to search";
  } else if (hasMore) {
    statusText = `Showing first ${results.length} results`;
  } else {
    statusText = `${results.length} result${results.length === 1 ? "" : "s"}`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[10vh] flex max-h-[70vh] w-full max-w-xl -translate-y-0 flex-col overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search the current project and choose a result to jump to it.
        </DialogDescription>
        {/* Header: search input + type filter */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--cf-border)] shrink-0">
          <Search
            className="w-4 h-4 text-[var(--cf-muted)] shrink-0"
            aria-hidden="true"
          />
          <Input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={searchMode === "semantic" ? "Search blocks, labels, math…" : "Search source text…"}
            className="h-8 flex-1 border-0 bg-transparent px-0 py-0 shadow-none focus:ring-0"
          />
          {searchMode === "semantic" && (
            <Select
              value={typeFilter || ALL_TYPES_VALUE}
              onValueChange={(value) => onTypeFilterChange(value === ALL_TYPES_VALUE ? "" : value)}
            >
              <SelectTrigger
                aria-label="Filter search results by block type"
                className="h-8 w-[8.5rem] border-[var(--cf-border)] bg-[var(--cf-subtle)] px-2 text-xs shadow-none"
              >
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TYPES_VALUE}>All types</SelectItem>
                {BLOCK_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Results list */}
        <ScrollArea className="flex-1">
          {grouped.size === 0 ? (
            <div className="px-4 py-3 text-xs text-[var(--cf-muted)] italic">{statusText}</div>
          ) : (
            Array.from(grouped.entries()).map(([file, entries]) => (
              <div key={file}>
                {/* File group header */}
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--cf-muted)] bg-[var(--cf-subtle)] border-b border-[var(--cf-border)] sticky top-0">
                  {basename(file)}
                  <span className="ml-1 font-normal normal-case text-[var(--cf-muted)]">
                    — {file}
                  </span>
                </div>

                {/* Entries in this file */}
                {entries.map((entry) => (
                  <SearchResultItem key={`${entry.file}:${entry.position.from}`} entry={entry} onClick={onResultSelect} />
                ))}
              </div>
            ))
          )}
        </ScrollArea>

        {/* Visually-hidden live region — announces result count to screen readers */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {statusText}
        </div>

        {/* Status bar */}
        {grouped.size > 0 && (
          <div className="shrink-0 px-3 py-1 border-t border-[var(--cf-border)] text-xs text-[var(--cf-muted)] bg-[var(--cf-bg)]">
            {statusText}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
