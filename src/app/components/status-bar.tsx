import { memo, useState, useRef, useEffect, useCallback, useMemo, useSyncExternalStore } from "react";
import { markdownEditorModes, type EditorMode } from "../../editor";
import { computeDocStats, formatReadingTime, type DocStats } from "../writing-stats";
import { subscribeFpsMeter, getFpsMeterSnapshot } from "../fps-meter";
import { cn } from "../lib/utils";
import { useEditorTelemetry } from "../stores/editor-telemetry-store";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CursorPosition {
  line: number;
  col: number;
}

export interface StatusBarProps {
  editorMode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onOpenPalette?: () => void;
  /** Monotonic active-document revision used to refresh lazily computed stats. */
  docRevision?: number;
  /** Returns the latest active-document text on demand. */
  getDocText?: () => string;
  /** Whether the active file is markdown (non-md files are Source-only). */
  isMarkdown?: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────────

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

const StatsPopover = memo(function StatsPopover({ stats, anchorRef, onClose }: StatsPopoverProps) {
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
        className="fixed z-50 min-w-[200px] rounded-md border border-[var(--cf-border)] bg-[var(--cf-bg)] p-3 text-xs text-[var(--cf-fg)]"
      >
        <div className="font-semibold text-sm mb-2 text-[var(--cf-fg)]">
          Writing Statistics
        </div>
        <div className="flex flex-col gap-1">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-6">
              <span className="text-[var(--cf-muted)]">{label}</span>
              <span className="font-medium tabular-nums">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
});

// ── FpsIndicator ──────────────────────────────────────────────────────────────

const FpsIndicator = memo(function FpsIndicator() {
  const { enabled, fps, frameTime } = useSyncExternalStore(subscribeFpsMeter, getFpsMeterSnapshot);
  if (!enabled) return null;

  return (
    <span className="tabular-nums text-[var(--cf-muted)]" title={`${frameTime} ms/frame`}>
      {fps} FPS
    </span>
  );
});

// ── StatusBar ──────────────────────────────────────────────────────────────────

/**
 * Status bar shown at the bottom of the editor.
 *
 * Left:   word count + character count (clickable — opens stats popover)
 * Center: cursor position Ln/Col
 * Right:  mode indicator (clickable to cycle Rich ↔ Source)
 */
export function StatusBar({
  editorMode,
  onModeChange,
  onOpenPalette,
  docRevision = 0,
  getDocText,
  isMarkdown = true,
}: StatusBarProps) {
  const wordCount = useEditorTelemetry((s) => s.wordCount);
  const charCount = useEditorTelemetry((s) => s.charCount);
  const cursorLine = useEditorTelemetry((s) => s.cursorLine);
  const cursorCol = useEditorTelemetry((s) => s.cursorCol);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const wordCountRef = useRef<HTMLButtonElement | null>(null);

  // Full stats only when the popover is open — keeps sentence segmentation off the edit hot path.
  const stats = useMemo<DocStats | null>(
    () => (popoverOpen ? computeDocStats(getDocText?.() ?? "") : null),
    [docRevision, getDocText, popoverOpen],
  );

  const cycleMode = useCallback(() => {
    const idx = markdownEditorModes.indexOf(editorMode);
    const next = markdownEditorModes[(idx + 1) % markdownEditorModes.length];
    onModeChange(next);
  }, [editorMode, onModeChange]);

  const closePopover = useCallback(() => setPopoverOpen(false), []);

  const wordLabel = wordCount === 1 ? "1 word" : `${wordCount} words`;
  const charLabel = `${charCount} chars`;

  return (
    <>
      <div data-statusbar className="shrink-0 flex items-center border-t border-[var(--cf-border)] bg-[var(--cf-bg)] h-6 px-2 text-xs text-[var(--cf-muted)] select-none">
        {/* Left: word + char count */}
        <div className="flex items-center gap-2">
          <button
            ref={wordCountRef}
            type="button"
            aria-label="Writing statistics"
            aria-expanded={popoverOpen}
            onClick={() => setPopoverOpen((v) => !v)}
            className={cn(
              "px-1 rounded hover:bg-[var(--cf-hover)] transition-colors",
              popoverOpen && "bg-[var(--cf-hover)]",
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
            Ln {cursorLine}, Col {cursorCol}
          </span>
        </div>

        {/* Right: FPS meter + command palette + mode indicator */}
        <div className="flex items-center gap-1 pr-1">
          <FpsIndicator />
          {onOpenPalette && (
            <button
              type="button"
              aria-label="Command Palette (⇧⌘P)"
              onClick={onOpenPalette}
              className="px-1 rounded hover:bg-[var(--cf-hover)] transition-colors"
            >
              ⌘
            </button>
          )}
          <button
            type="button"
            data-testid="mode-button"
            aria-label={isMarkdown ? `Editor mode: ${MODE_LABELS[editorMode]}. Click to cycle mode` : "Source mode only for non-markdown files"}
            onClick={cycleMode}
            disabled={!isMarkdown}
            className="px-1 rounded hover:bg-[var(--cf-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {MODE_LABELS[editorMode]}
          </button>
        </div>
      </div>

      {/* Stats popover — rendered in the same stacking context, positioned fixed */}
      {popoverOpen && stats && (
        <StatsPopover
          stats={stats}
          anchorRef={wordCountRef}
          onClose={closePopover}
        />
      )}
    </>
  );
}
