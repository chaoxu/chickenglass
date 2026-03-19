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

/** Return the file name portion of a path (last segment after "/"). */
function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
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

  // Escape closes the panel. Cmd/Ctrl+Shift+F is handled by the parent app.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

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
  const statusText = searching
    ? "Searching…"
    : results.length === 0
      ? text || typeFilter
        ? "No results found"
        : "Type to search"
      : `${results.length} result${results.length === 1 ? "" : "s"}`;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40"
      onMouseDown={(e) => {
        // Close when clicking backdrop (not the panel itself).
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      {/* Panel */}
      <div
        className="w-full max-w-xl bg-[var(--cg-bg)] border border-[var(--cg-border)] rounded-lg flex flex-col overflow-hidden"
        style={{ maxHeight: "70vh" }}
      >
        {/* Header: search input + type filter */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--cg-border)] shrink-0">
          <Search
            className="w-4 h-4 text-[var(--cg-muted)] shrink-0"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search blocks, labels, math…"
            className="flex-1 bg-transparent outline-none text-sm text-[var(--cg-fg)] placeholder:text-[var(--cg-muted)]"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-xs bg-[var(--cg-subtle)] border border-[var(--cg-border)] rounded px-1 py-0.5 text-[var(--cg-fg)] outline-none cursor-pointer"
          >
            <option value="">All types</option>
            {BLOCK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto">
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
        </div>

        {/* Status bar */}
        {grouped.size > 0 && (
          <div className="shrink-0 px-3 py-1 border-t border-[var(--cg-border)] text-xs text-[var(--cg-muted)] bg-[var(--cg-subtle)]">
            {statusText}
          </div>
        )}
      </div>
    </div>
  );
}
