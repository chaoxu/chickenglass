/**
 * React search panel for querying the semantic document index.
 *
 * Provides a modal overlay with a text input and block-type filter.
 * Results are grouped by file with type badge, number, title, and
 * a content preview. Cmd/Ctrl+Shift+F toggles the panel.
 */

import { memo } from "react";
import { Search } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import type { BackgroundIndexer } from "../../index/indexer";
import type { IndexEntry } from "../../index/query-api";
import { basename } from "../lib/utils";
import type { AppSearchMode } from "../search";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useSearchIndexer } from "../hooks/use-search-indexer";
import { BLOCK_MANIFEST_ENTRIES } from "../../constants/block-manifest";

/**
 * Block types for the search filter dropdown.
 *
 * Standard block types are derived from BLOCK_MANIFEST (excluding embed and
 * blockquote which aren't indexed as semantic blocks). "equation" and "heading"
 * are search-only index types not in the manifest.
 */
const BLOCK_TYPES: readonly string[] = [
  ...BLOCK_MANIFEST_ENTRIES
    .filter((e) => e.specialBehavior !== "embed" && e.specialBehavior !== "blockquote")
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
  /** Monotonic version that bumps whenever the backing index changes. */
  searchVersion: number;
  /** The in-memory document index to query. */
  indexer?: BackgroundIndexer | null;
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
 * Modal search panel that queries the document index.
 * Results are grouped by file. Clicking a result calls onResultSelect
 * and closes the panel.
 */
export function SearchPanel({
  open,
  onOpenChange,
  onResultSelect,
  searchMode,
  searchVersion,
  indexer,
}: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input whenever panel opens; clear state on close.
  useEffect(() => {
    if (open) {
      // Defer one frame so the element is visible before focusing.
      const id = requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    } else {
      setQuery("");
      setTypeFilter("");
    }
  }, [open]);

  useEffect(() => {
    if (searchMode === "source") {
      setTypeFilter("");
    }
  }, [searchMode]);

  const { results, searching } = useSearchIndexer(
    open,
    query,
    typeFilter,
    searchMode,
    searchVersion,
    indexer,
  );

  const handleResultClick = useCallback(
    (entry: IndexEntry) => {
      onResultSelect(entry);
      onOpenChange(false);
    },
    [onResultSelect, onOpenChange],
  );

  if (!open) return null;

  const grouped = groupByFile(results);
  const text = query.trim();
  let statusText: string;
  if (searching) {
    statusText = "Searching…";
  } else if (results.length === 0) {
    statusText = text || typeFilter ? "No results found" : "Type to search";
  } else {
    statusText = `${results.length} result${results.length === 1 ? "" : "s"}`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[10vh] flex max-h-[70vh] w-full max-w-xl -translate-y-0 flex-col overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        {/* Header: search input + type filter */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--cf-border)] shrink-0">
          <Search
            className="w-4 h-4 text-[var(--cf-muted)] shrink-0"
            aria-hidden="true"
          />
          <Input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchMode === "semantic" ? "Search blocks, labels, math…" : "Search source text…"}
            className="h-8 flex-1 border-0 bg-transparent px-0 py-0 shadow-none focus:ring-0"
          />
          {searchMode === "semantic" && (
            <Select
              value={typeFilter || ALL_TYPES_VALUE}
              onValueChange={(value) => setTypeFilter(value === ALL_TYPES_VALUE ? "" : value)}
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
                  <SearchResultItem key={`${entry.file}:${entry.position.from}`} entry={entry} onClick={handleResultClick} />
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
