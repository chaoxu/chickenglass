import { useState, useCallback, useMemo } from "react";
import { cn } from "../lib/utils";
import {
  SYMBOL_CATEGORIES,
  insertSymbol,
  type MathSymbol,
} from "../symbol-panel";
import type { EditorView } from "@codemirror/view";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SymbolPanelProps {
  /** Called with the LaTeX string when the user clicks a symbol. */
  onInsert: (latex: string) => void;
  /**
   * Optional live EditorView. When provided, `insertSymbol` is called directly
   * (handles math-context detection). When omitted, `onInsert` receives the raw
   * LaTeX and the caller is responsible for insertion.
   */
  view?: EditorView | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Sidebar section that shows categorised math symbols with live search.
 *
 * Each symbol renders its Unicode preview character and a tooltip with the
 * LaTeX command. Clicking inserts the LaTeX at the CM6 cursor position
 * (respecting inline-math context) via `insertSymbol`.
 */
export function SymbolPanel({ onInsert, view }: SymbolPanelProps) {
  const [query, setQuery] = useState("");

  const handleSymbolClick = useCallback(
    (sym: MathSymbol) => {
      if (view) {
        insertSymbol(view, sym.latex);
      } else {
        onInsert(sym.latex);
      }
    },
    [view, onInsert],
  );

  const lowerQuery = query.toLowerCase().trim();

  // Filter categories — hide categories with no matches.
  // Memoized so filtering ~200 symbols only runs when the query changes.
  const visible = useMemo(
    () =>
      SYMBOL_CATEGORIES.map((cat) => ({
        name: cat.name,
        symbols: lowerQuery
          ? cat.symbols.filter(
              (s) =>
                s.label.toLowerCase().includes(lowerQuery) ||
                s.latex.toLowerCase().includes(lowerQuery) ||
                s.display.includes(lowerQuery),
            )
          : cat.symbols,
      })).filter((cat) => cat.symbols.length > 0),
    [lowerQuery],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search */}
      <div className="shrink-0 px-2 py-1.5 border-b border-[var(--cg-border)]">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search symbols…"
          className={cn(
            "w-full text-xs rounded px-2 py-1",
            "bg-[var(--cg-bg)] border border-[var(--cg-border)]",
            "text-[var(--cg-fg)] placeholder:text-[var(--cg-muted)]",
            "focus:outline-none focus:ring-1 focus:ring-[var(--cg-accent)]",
          )}
        />
      </div>

      {/* Symbol list */}
      <div className="flex-1 overflow-y-auto min-h-0 px-2 py-1 overscroll-contain">
        {visible.length === 0 ? (
          <p className="text-xs text-[var(--cg-muted)] text-center py-4">
            No symbols found.
          </p>
        ) : (
          visible.map((cat) => (
            <div key={cat.name} className="mb-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--cg-muted)] mb-1 px-0.5">
                {cat.name}
              </div>
              <div className="grid grid-cols-6 gap-0.5">
                {cat.symbols.map((sym) => (
                  <button
                    key={sym.latex}
                    type="button"
                    title={`${sym.label} (${sym.latex})`}
                    onMouseDown={(e) => {
                      // Prevent stealing focus from the editor.
                      e.preventDefault();
                      handleSymbolClick(sym);
                    }}
                    className={cn(
                      "flex items-center justify-center h-7 rounded text-sm leading-none",
                      "hover:bg-[var(--cg-hover)] active:bg-[var(--cg-active)]",
                      "text-[var(--cg-fg)] transition-colors",
                    )}
                    aria-label={`${sym.label}: ${sym.latex}`}
                  >
                    {sym.display}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
