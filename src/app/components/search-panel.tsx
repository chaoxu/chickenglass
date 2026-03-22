/**
 * React search panel for querying the semantic document index.
 *
 * Provides a modal overlay with a text input and block-type filter.
 * Results are grouped by file with type badge, number, title, and
 * a content preview. Cmd/Ctrl+Shift+F toggles the panel.
 */

import { Search } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import type { BackgroundIndexer } from "../../index/indexer";
import type { IndexEntry, IndexQuery } from "../../index/query-api";
import { basename } from "../lib/utils";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

/** Known block types for the filter dropdown. */
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

const ALL_TYPES_VALUE = "__all__";

export interface SearchPanelProps {
  /** Whether the panel is visible. */
  open: boolean;
  /** Called to open or close the panel. */
  onOpenChange: (open: boolean) => void;
  /** Called when the user clicks a result. */
  onResultSelect: (file: string, pos: number) => void;
  /** The background indexer to query. */
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

/** Build an IndexQuery from raw search text and optional type filter. */
function buildQuery(text: string, type: string | undefined): IndexQuery {
  // Detect label search: text starting with # or containing : like eq:foo
  const isLabel = text.startsWith("#") || /^[a-z]+-?\w*:\w/i.test(text);
  if (isLabel) {
    const label = text.startsWith("#") ? text.slice(1) : text;
    return { type, label };
  }
  return { type, content: text || undefined };
}

/**
 * Modal search panel that queries the BackgroundIndexer.
 * Results are grouped by file. Clicking a result calls onResultSelect
 * and closes the panel.
 */
export function SearchPanel({ open, onOpenChange, onResultSelect, indexer }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [results, setResults] = useState<readonly IndexEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input whenever panel opens.
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
      setResults([]);
    }
  }, [open]);

  // Re-run search whenever query, type filter, or indexer changes.
  useEffect(() => {
    if (!open || !indexer) {
      setResults([]);
      return;
    }

    const text = query.trim();
    const type = typeFilter || undefined;
    const indexQuery = buildQuery(text, type);

    setSearching(true);
    let cancelled = false;

    indexer.query(indexQuery).then(
      (entries) => {
        if (!cancelled) {
          setResults(entries);
          setSearching(false);
        }
      },
      () => {
        if (!cancelled) {
          setResults([]);
          setSearching(false);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [open, query, typeFilter, indexer]);

  const handleResultClick = useCallback(
    (entry: IndexEntry) => {
      onResultSelect(entry.file, entry.position.from);
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
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--cg-border)] shrink-0">
          <Search
            className="w-4 h-4 text-[var(--cg-muted)] shrink-0"
            aria-hidden="true"
          />
          <Input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search blocks, labels, math…"
            className="h-8 flex-1 border-0 bg-transparent px-0 py-0 shadow-none focus:ring-0"
          />
          <Select
            value={typeFilter || ALL_TYPES_VALUE}
            onValueChange={(value) => setTypeFilter(value === ALL_TYPES_VALUE ? "" : value)}
          >
            <SelectTrigger
              aria-label="Filter search results by block type"
              className="h-8 w-[8.5rem] border-[var(--cg-border)] bg-[var(--cg-subtle)] px-2 text-xs shadow-none"
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
        </div>

        {/* Results list */}
        <ScrollArea className="flex-1">
          {grouped.size === 0 ? (
            <div className="px-4 py-3 text-xs text-[var(--cg-muted)] italic">{statusText}</div>
          ) : (
            Array.from(grouped.entries()).map(([file, entries]) => (
              <div key={file}>
                {/* File group header */}
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--cg-muted)] bg-[var(--cg-subtle)] border-b border-[var(--cg-border)] sticky top-0">
                  {basename(file)}
                  <span className="ml-1 font-normal normal-case text-[var(--cg-muted)]">
                    — {file}
                  </span>
                </div>

                {/* Entries in this file */}
                {entries.map((entry, i) => (
                  <button
                    key={i}
                    className="w-full text-left px-3 py-2 flex flex-col gap-0.5 hover:bg-[var(--cg-hover)] border-b border-[var(--cg-border)] last:border-b-0 transition-colors duration-[var(--cg-transition,0.15s)]"
                    onClick={() => handleResultClick(entry)}
                  >
                    {/* Top row: type badge + number + title */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded bg-[var(--cg-subtle)] text-[var(--cg-muted)]">
                        {entry.type}
                      </span>
                      {entry.number !== undefined && (
                        <span className="shrink-0 text-xs text-[var(--cg-muted)] font-mono">
                          {entry.number}
                        </span>
                      )}
                      {entry.title && (
                        <span className="truncate text-sm text-[var(--cg-fg)] font-medium">
                          {entry.title}
                        </span>
                      )}
                      {entry.label && (
                        <span className="ml-auto shrink-0 text-[10px] font-mono text-[var(--cg-muted)]">
                          #{entry.label}
                        </span>
                      )}
                    </div>

                    {/* Content preview */}
                    {entry.content && (
                      <span className="text-xs text-[var(--cg-muted)] truncate">
                        {previewContent(entry.content)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </ScrollArea>

        {/* Status bar */}
        {grouped.size > 0 && (
          <div className="shrink-0 px-3 py-1 border-t border-[var(--cg-border)] text-xs text-[var(--cg-muted)] bg-[var(--cg-bg)]">
            {statusText}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
