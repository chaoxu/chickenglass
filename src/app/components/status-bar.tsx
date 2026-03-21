import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { EditorMode } from "../../editor";
import { computeDocStats, formatReadingTime } from "../writing-stats";
import type { DocStats } from "../writing-stats";
import { cn } from "../lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CursorPosition {
  line: number;
  col: number;
}

export interface StatusBarProps {
  wordCount: number;
  cursorPos: CursorPosition;
  editorMode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onOpenPalette?: () => void;
  /** Raw document text — used to compute the stats popover. */
  docText?: string;
  /** Whether the active file is markdown (non-md files are Source-only). */
  isMarkdown?: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MODE_ORDER: EditorMode[] = ["rich", "source", "read"];

const MODE_LABELS: Record<EditorMode, string> = {
  rich: "Rich",
  source: "Source",
  read: "Read",
};

// ── StatsPopover ───────────────────────────────────────────────────────────────

interface StatsPopoverProps {
  stats: DocStats;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

function StatsPopover({ stats, anchorRef, onClose }: StatsPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Position the panel above the anchor element.
  // Manual positioning is sufficient here — the anchor is always at the bottom
  // of the viewport so there is no collision risk. @floating-ui was evaluated
  // (#180, #189) but rejected: only 2 manual positioning sites exist in the
  // codebase, both are trivial, and the ~8KB gzipped cost is not justified.
  useEffect(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const rect = anchor.getBoundingClientRect();
    panel.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    panel.style.left = `${rect.left}px`;
  }, [anchorRef]);

  // Dismiss on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const rows: Array<[string, string]> = [
    ["Words", stats.words.toLocaleString()],
    ["Characters", stats.chars.toLocaleString()],
    ["Without spaces", stats.charsNoSpaces.toLocaleString()],
    ["Sentences", stats.sentences.toLocaleString()],
    ["Reading time", formatReadingTime(stats.readingMinutes)],
  ];

  return (
    <>
      {/* Transparent backdrop — click closes popover */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Writing statistics"
        tabIndex={-1}
        className="fixed z-50 min-w-[200px] rounded-md border border-[var(--cg-border)] bg-[var(--cg-bg)] p-3 text-xs text-[var(--cg-fg)]"
      >
        <div className="font-semibold text-sm mb-2 text-[var(--cg-fg)]">
          Writing Statistics
        </div>
        <div className="flex flex-col gap-1">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-6">
              <span className="text-[var(--cg-muted)]">{label}</span>
              <span className="font-medium tabular-nums">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── StatusBar ──────────────────────────────────────────────────────────────────

/**
 * Status bar shown at the bottom of the editor.
 *
 * Left:   word count + character count (clickable — opens stats popover)
 * Center: cursor position Ln/Col
 * Right:  mode indicator (clickable to cycle Rich → Source → Read)
 */
export function StatusBar({
  wordCount,
  cursorPos,
  editorMode,
  onModeChange,
  onOpenPalette,
  docText = "",
  isMarkdown = true,
}: StatusBarProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const wordCountRef = useRef<HTMLButtonElement | null>(null);

  // Compute stats only when docText changes — shared by the word-count badge and the popover.
  const stats = useMemo(() => computeDocStats(docText), [docText]);

  const cycleMode = useCallback(() => {
    const idx = MODE_ORDER.indexOf(editorMode);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    onModeChange(next);
  }, [editorMode, onModeChange]);

  const closePopover = useCallback(() => setPopoverOpen(false), []);

  const wordLabel = wordCount === 1 ? "1 word" : `${wordCount} words`;
  const charLabel = `${stats.chars} chars`;

  return (
    <>
      <div className="shrink-0 flex items-center border-t border-[var(--cg-border)] bg-[var(--cg-bg)] h-6 px-2 text-xs text-[var(--cg-muted)] select-none">
        {/* Left: word + char count */}
        <div className="flex items-center gap-2">
          <button
            ref={wordCountRef}
            type="button"
            title="Click for writing statistics"
            onClick={() => setPopoverOpen((v) => !v)}
            className={cn(
              "px-1 rounded hover:bg-[var(--cg-hover)] transition-colors",
              popoverOpen && "bg-[var(--cg-hover)]",
            )}
          >
            {wordLabel}
          </button>
          <span className="opacity-50">·</span>
          <span>{charLabel}</span>
        </div>

        {/* Center: cursor position */}
        <div className="flex-1 flex items-center justify-center">
          <span>
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
        </div>

        {/* Right: command palette + mode indicator */}
        <div className="flex items-center gap-1">
          {onOpenPalette && (
            <button
              type="button"
              title="Command Palette (⇧⌘P)"
              onClick={onOpenPalette}
              className="px-1 rounded hover:bg-[var(--cg-hover)] transition-colors"
            >
              ⌘
            </button>
          )}
          <button
            type="button"
            title={isMarkdown ? "Click to cycle editor mode" : "Source mode only for non-markdown files"}
            onClick={cycleMode}
            disabled={!isMarkdown}
            className="px-1 rounded hover:bg-[var(--cg-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {MODE_LABELS[editorMode]}
          </button>
        </div>
      </div>

      {/* Stats popover — rendered in the same stacking context, positioned fixed */}
      {popoverOpen && (
        <StatsPopover
          stats={stats}
          anchorRef={wordCountRef}
          onClose={closePopover}
        />
      )}
    </>
  );
}
