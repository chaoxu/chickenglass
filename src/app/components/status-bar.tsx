import { useState, useRef, useEffect, useCallback, useMemo, useSyncExternalStore } from "react";
import { Bug } from "lucide-react";
import { markdownEditorModes, type EditorMode } from "../../editor-display-mode";
import { computeDocStats, type DocStats } from "../writing-stats";
import { cn } from "../lib/utils";
import { useEditorTelemetry } from "../stores/editor-telemetry-store";
import { buildInfo } from "../build-info";
import {
  readWindowDebugLaneState,
  subscribeWindowDebugLaneState,
  toggleWindowDebugLane,
  type DebugLaneWindowState,
} from "../../editor/debug-lane-state";
import {
  EMPTY_ACTIVE_DOCUMENT_SNAPSHOT,
  unsubscribeNoop,
  type ActiveDocumentSignal,
} from "../active-document-signal";
import { ConfigButton } from "./status-bar-config";
import { DebugButton } from "./status-bar-debug";
import { FpsIndicator } from "./status-bar-fps";
import { StatsPopover } from "./status-bar-stats";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CursorPosition {
  line: number;
  col: number;
}

export interface StatusBarProps {
  editorMode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onOpenPalette?: () => void;
  onOpenSettings?: () => void;
  /** External signal used to refresh full stats without rerendering the shell. */
  activeDocumentSignal?: ActiveDocumentSignal;
  /** Returns the latest active-document text on demand. */
  getDocText?: () => string;
  /** Whether the active file is markdown (non-md files are Source-only). */
  isMarkdown?: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MODE_LABELS: Record<EditorMode, string> = {
  "cm6-rich": "CM6 Rich",
  lexical: "Lexical",
  source: "Source",
};

// ── StatusBar ──────────────────────────────────────────────────────────────────

/**
 * Status bar shown at the bottom of the editor.
 *
 * Left:   word count + character count (clickable — opens stats popover)
 * Center: cursor position Ln/Col
 * Right:  build info + mode indicator (mode is clickable to cycle editor surfaces)
 */
export function StatusBar({
  editorMode,
  onModeChange,
  onOpenPalette,
  onOpenSettings,
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
  const [debugLaneState, setDebugLaneState] = useState<DebugLaneWindowState>(() => (
    readWindowDebugLaneState()
  ));
  const showDebugControls = import.meta.env.DEV;

  // Full stats only when the popover is open — keeps sentence segmentation off the edit hot path.
  const stats = useMemo<DocStats | null>(
    () => (popoverOpen ? computeDocStats(getDocText?.() ?? "") : null),
    [activeDocument.revision, getDocText, popoverOpen],
  );

  const cycleMode = useCallback(() => {
    const idx = markdownEditorModes.indexOf(editorMode);
    const next = markdownEditorModes[
      (Math.max(0, idx) + 1) % markdownEditorModes.length
    ];
    onModeChange(next);
  }, [editorMode, onModeChange]);

  const closePopover = useCallback(() => setPopoverOpen(false), []);
  const toggleDebugLane = useCallback(() => {
    setDebugLaneState(toggleWindowDebugLane());
  }, []);

  useEffect(() => {
    if (!showDebugControls) {
      return;
    }

    setDebugLaneState(readWindowDebugLaneState());
    return subscribeWindowDebugLaneState(() => {
      setDebugLaneState(readWindowDebugLaneState());
    });
  }, [showDebugControls]);

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
          <ConfigButton onOpenSettings={onOpenSettings} />
          {showDebugControls && <DebugButton />}
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
          {showDebugControls && (
            <button
              type="button"
              data-testid="debug-lane-button"
              aria-label={debugLaneState.enabled
                ? "Debug lane enabled. Click to hide debug lane"
                : "Debug lane disabled. Click to show debug lane"}
              aria-pressed={debugLaneState.enabled}
              title={debugLaneState.available
                ? (debugLaneState.enabled ? "Hide debug lane" : "Show debug lane")
                : "Open a document to enable debug tools"}
              onClick={toggleDebugLane}
              disabled={!debugLaneState.available}
              className={cn(
                "px-1 rounded transition-colors",
                debugLaneState.enabled
                  ? "bg-[var(--cf-hover)] text-[var(--cf-fg)]"
                  : "hover:bg-[var(--cf-hover)]",
                !debugLaneState.available && "opacity-50 cursor-not-allowed",
              )}
            >
              <Bug className="h-3.5 w-3.5" aria-hidden="true" />
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
