import { memo, useState, useRef, useEffect, useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { Bug, Settings } from "lucide-react";
import { useAppWorkspaceController } from "../contexts/app-workspace-context";
import type { Theme } from "../theme-manager";
import { markdownEditorModes, type EditorMode } from "../editor-mode";
import { computeDocStats, formatReadingTime, type DocStats } from "../writing-stats";
import { subscribeFpsMeter, getFpsMeterSnapshot } from "../fps-meter";
import { cn } from "../lib/utils";
import { useEditorTelemetry } from "../stores/editor-telemetry-store";
import { buildInfo } from "../build-info";
import { useDevSettings, selectAnyDebugActive, type DevSettings } from "../dev-settings";
import {
  EMPTY_ACTIVE_DOCUMENT_SNAPSHOT,
  unsubscribeNoop,
  type ActiveDocumentSignal,
} from "../active-document-signal";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CursorPosition {
  line: number;
  col: number;
}

export interface StatusBarProps {
  editorMode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onOpenPalette?: () => void;
  /** External signal used to refresh full stats without rerendering the shell. */
  activeDocumentSignal?: ActiveDocumentSignal;
  /** Returns the latest active-document text on demand. */
  getDocText?: () => string;
  /** Whether the active file is markdown (non-md files are Source-only). */
  isMarkdown?: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MODE_LABELS: Record<EditorMode, string> = {
  lexical: "Lexical",
  source: "Source",
};
// ── StatusBarPopover ──────────────────────────────────────────────────────────
// Shared backdrop + positioning + Escape-dismiss wrapper for status-bar popovers.
// Manual positioning is sufficient — the anchor is always at the bottom of the
// viewport so there is no collision risk. @floating-ui was evaluated (#180, #189)
// but rejected: only 2 manual positioning sites exist, both trivial.

interface StatusBarPopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  align: "left" | "right";
  ariaLabel: string;
  minWidth: string;
  children: ReactNode;
}

function StatusBarPopover({ anchorRef, onClose, align, ariaLabel, minWidth, children }: StatusBarPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const rect = anchor.getBoundingClientRect();
    panel.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    if (align === "left") {
      panel.style.left = `${rect.left}px`;
    } else {
      panel.style.right = `${window.innerWidth - rect.right}px`;
    }
  }, [anchorRef, align]);

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

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={ariaLabel}
        tabIndex={-1}
        className="fixed z-50 rounded-md border border-[var(--cf-border)] bg-[var(--cf-bg)] p-3 text-xs text-[var(--cf-fg)]"
        style={{ minWidth }}
      >
        {children}
      </div>
    </>
  );
}

// ── StatsPopover ───────────────────────────────────────────────────────────────

interface StatsPopoverProps {
  stats: DocStats;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

const StatsPopover = memo(function StatsPopover({ stats, anchorRef, onClose }: StatsPopoverProps) {
  const rows: Array<[string, string]> = [
    ["Words", stats.words.toLocaleString()],
    ["Characters", stats.chars.toLocaleString()],
    ["Without spaces", stats.charsNoSpaces.toLocaleString()],
    ["Sentences", stats.sentences.toLocaleString()],
    ["Reading time", formatReadingTime(stats.readingMinutes)],
  ];

  return (
    <StatusBarPopover anchorRef={anchorRef} onClose={onClose} align="left" ariaLabel="Writing statistics" minWidth="200px">
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
    </StatusBarPopover>
  );
});

// ── DebugPopover ──────────────────────────────────────────────────────────────

const DEBUG_TOGGLE_LABELS: ReadonlyArray<readonly [keyof DevSettings, string]> = [
  ["treeView", "Tree View"],
  ["perfPanel", "Perf Panel"],
  ["fpsCounter", "FPS Counter"],
  ["commandLogging", "Command Log"],
  ["focusTracing", "Focus Tracing"],
  ["selectionAlwaysOn", "Selection Always On"],
];

interface DebugPopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

const DebugPopover = memo(function DebugPopover({ anchorRef, onClose }: DebugPopoverProps) {
  const settings = useDevSettings();

  return (
    <StatusBarPopover anchorRef={anchorRef} onClose={onClose} align="right" ariaLabel="Debug settings" minWidth="180px">
      <div className="font-semibold text-sm mb-2 text-[var(--cf-fg)]">
        Debug
      </div>
      <div className="flex flex-col gap-1.5">
        {DEBUG_TOGGLE_LABELS.map(([key, label]) => (
          <label key={key} className="flex items-center justify-between gap-4 cursor-pointer">
            <span className="text-[var(--cf-muted)]">{label}</span>
            <input
              type="checkbox"
              checked={settings[key]}
              onChange={() => settings.toggle(key)}
              className="accent-[var(--cf-accent,#0969da)]"
            />
          </label>
        ))}
      </div>
    </StatusBarPopover>
  );
});

// ── DebugButton ───────────────────────────────────────────────────────────────

const DebugButton = memo(function DebugButton() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const anyActive = useDevSettings(selectAnyDebugActive);
  const closePopover = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="Debug settings"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "px-1 rounded hover:bg-[var(--cf-hover)] transition-colors",
          anyActive && "text-[var(--cf-accent,#0969da)]",
        )}
      >
        <Bug size={14} />
      </button>
      {open && (
        <DebugPopover
          anchorRef={btnRef}
          onClose={closePopover}
        />
      )}
    </>
  );
});

// ── ConfigPopover ────────────────────────────────────────────────────────────

const THEME_OPTIONS: ReadonlyArray<readonly [Theme, string]> = [
  ["light", "Light"],
  ["dark", "Dark"],
  ["system", "System"],
];

interface ConfigPopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

const ConfigPopover = memo(function ConfigPopover({ anchorRef, onClose }: ConfigPopoverProps) {
  const { settings, updateSetting } = useAppWorkspaceController();

  return (
    <StatusBarPopover anchorRef={anchorRef} onClose={onClose} align="right" ariaLabel="Editor settings" minWidth="160px">
      <div className="font-semibold text-sm mb-2 text-[var(--cf-fg)]">
        Settings
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="text-[var(--cf-muted)] text-xs mb-0.5">Theme</div>
        {THEME_OPTIONS.map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="cf-theme"
              value={value}
              checked={settings.theme === value}
              onChange={() => updateSetting("theme", value)}
              className="accent-[var(--cf-accent,#0969da)]"
            />
            <span className="text-[var(--cf-muted)]">{label}</span>
          </label>
        ))}
      </div>
    </StatusBarPopover>
  );
});

// ── ConfigButton ─────────────────────────────────────────────────────────────

const ConfigButton = memo(function ConfigButton() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const closePopover = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="Editor settings"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "px-1 rounded hover:bg-[var(--cf-hover)] transition-colors",
          open && "bg-[var(--cf-hover)]",
        )}
      >
        <Settings size={14} />
      </button>
      {open && (
        <ConfigPopover
          anchorRef={btnRef}
          onClose={closePopover}
        />
      )}
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
 * Right:  build info + mode indicator (mode is clickable to cycle Lexical ↔ Source)
 */
export function StatusBar({
  editorMode,
  onModeChange,
  onOpenPalette,
  activeDocumentSignal,
  getDocText,
  isMarkdown = true,
}: StatusBarProps) {
  const wordCount = useEditorTelemetry((s) => s.wordCount);
  const charCount = useEditorTelemetry((s) => s.charCount);
  const cursorLine = useEditorTelemetry((s) => s.cursorLine);
  const cursorCol = useEditorTelemetry((s) => s.cursorCol);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const wordCountRef = useRef<HTMLButtonElement | null>(null);
  const subscribeToActiveDocument = useCallback((onStoreChange: () => void) => {
    if (!popoverOpen || !activeDocumentSignal) {
      return unsubscribeNoop;
    }
    return activeDocumentSignal.subscribe(onStoreChange);
  }, [activeDocumentSignal, popoverOpen]);
  const getActiveDocumentSnapshot = useCallback(() => {
    if (!popoverOpen || !activeDocumentSignal) {
      return EMPTY_ACTIVE_DOCUMENT_SNAPSHOT;
    }
    return activeDocumentSignal.getSnapshot();
  }, [activeDocumentSignal, popoverOpen]);
  const activeDocument = useSyncExternalStore(
    subscribeToActiveDocument,
    getActiveDocumentSnapshot,
    getActiveDocumentSnapshot,
  );

  // Full stats only when the popover is open — keeps sentence segmentation off the edit hot path.
  const stats = useMemo<DocStats | null>(
    () => (popoverOpen ? computeDocStats(getDocText?.() ?? "") : null),
    [activeDocument.revision, getDocText, popoverOpen],
  );

  const cycleMode = useCallback(() => {
    const idx = markdownEditorModes.indexOf(editorMode);
    const next = markdownEditorModes[(idx + 1) % markdownEditorModes.length];
    onModeChange(next);
  }, [editorMode, onModeChange]);

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

        {/* Right: FPS meter + build info + command palette + mode indicator */}
        <div className="flex items-center gap-1 pr-1">
          <FpsIndicator />
          {buildInfo && (
            <span
              className="px-1 tabular-nums text-[var(--cf-muted)]"
              title={buildInfo.title}
            >
              {buildInfo.label}
            </span>
          )}
          <ConfigButton />
          <DebugButton />
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
          onClose={() => setPopoverOpen(false)}
        />
      )}
    </>
  );
}
