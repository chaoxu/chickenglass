import { useRef, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import { cn } from "../lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

const DIVIDER_PX = 4;
const MIN_PANE_PX = 100;

// ── Helpers (outside component — pure functions, no deps) ─────────────────────

/** Clamp ratio so each pane is at least MIN_PANE_PX pixels. */
function clampRatio(r: number, total: number): number {
  const available = total - DIVIDER_PX;
  const minFrac = MIN_PANE_PX / available;
  return Math.max(minFrac, Math.min(1 - minFrac, r));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type SplitOrientation = "horizontal" | "vertical";

interface SplitPaneProps {
  orientation: SplitOrientation;
  /** Exactly two children: [primaryPane, secondaryPane]. */
  children: [ReactNode, ReactNode];
  /** Initial ratio for the first child (0–1). Defaults to 0.5. */
  initialRatio?: number;
  /** Called after each drag completes with the new pixel sizes. */
  onResize?: (primaryPx: number, secondaryPx: number) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Two-pane container with a draggable divider.
 *
 * - `orientation="vertical"` → left pane | divider | right pane (flex-row)
 * - `orientation="horizontal"` → top pane / divider / bottom pane (flex-col)
 * - Minimum pane size is 100 px on both sides.
 * - Pure CSS flexbox — no ResizeObserver, no absolute positioning.
 */
export function SplitPane({
  orientation,
  children,
  initialRatio = 0.5,
  onResize,
}: SplitPaneProps) {
  const [ratio, setRatio] = useState(() =>
    Math.max(0, Math.min(1, initialRatio)),
  );

  const containerRef = useRef<HTMLDivElement>(null);

  // Drag state stored in refs (no re-renders during drag).
  const dragging = useRef(false);
  const dragStartPos = useRef(0);
  const dragStartRatio = useRef(0);
  const dragTotalSize = useRef(0);
  // Track current ratio in a ref so onUp closure reads the final value, not
  // the stale React state snapshot captured at drag-start.
  const currentRatioRef = useRef(ratio);
  useEffect(() => { currentRatioRef.current = ratio; }, [ratio]);

  // Stable ref for onResize so the mousemove handler never goes stale.
  const onResizeRef = useRef(onResize);
  useEffect(() => { onResizeRef.current = onResize; }, [onResize]);

  // ── Drag logic ─────────────────────────────────────────────────────────────

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      dragTotalSize.current =
        orientation === "vertical" ? rect.width : rect.height;
      dragStartPos.current =
        orientation === "vertical" ? e.clientX : e.clientY;
      dragStartRatio.current = currentRatioRef.current;
      dragging.current = true;

      const onMove = (me: MouseEvent) => {
        if (!dragging.current) return;
        const pos = orientation === "vertical" ? me.clientX : me.clientY;
        const delta = pos - dragStartPos.current;
        const total = dragTotalSize.current;
        const newRatio = clampRatio(dragStartRatio.current + delta / total, total);
        currentRatioRef.current = newRatio;
        setRatio(newRatio);
      };

      const onUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);

        // Fire onResize with the final ratio after drag ends.
        if (containerRef.current && onResizeRef.current) {
          const r = containerRef.current.getBoundingClientRect();
          const t = orientation === "vertical" ? r.width : r.height;
          const finalRatio = currentRatioRef.current;
          onResizeRef.current(
            t * finalRatio - DIVIDER_PX / 2,
            t * (1 - finalRatio) - DIVIDER_PX / 2,
          );
        }
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [orientation],
  );

  // ── Styles ─────────────────────────────────────────────────────────────────

  const isVertical = orientation === "vertical";

  // Convert ratio to flex-basis percentages, subtracting half the divider.
  const primaryBasis = `calc(${(ratio * 100).toFixed(4)}% - ${DIVIDER_PX / 2}px)`;
  const secondaryBasis = `calc(${((1 - ratio) * 100).toFixed(4)}% - ${DIVIDER_PX / 2}px)`;

  // paneBaseStyle never changes — memoize to avoid a new object every render.
  const paneBaseStyle = useMemo<React.CSSProperties>(() => ({
    overflow: "hidden",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    flexGrow: 0,
  }), []);

  const primaryStyle: React.CSSProperties = {
    ...paneBaseStyle,
    ...(isVertical
      ? { width: primaryBasis, minWidth: MIN_PANE_PX, height: "100%" }
      : { height: primaryBasis, minHeight: MIN_PANE_PX, width: "100%" }),
  };

  const secondaryStyle: React.CSSProperties = {
    ...paneBaseStyle,
    ...(isVertical
      ? { width: secondaryBasis, minWidth: MIN_PANE_PX, height: "100%" }
      : { height: secondaryBasis, minHeight: MIN_PANE_PX, width: "100%" }),
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "split-pane flex w-full h-full overflow-hidden",
        isVertical ? "flex-row" : "flex-col",
      )}
    >
      {/* Primary pane */}
      <div className="split-pane-primary" style={primaryStyle}>
        {children[0]}
      </div>

      {/* Draggable divider */}
      <div
        role="separator"
        aria-orientation={isVertical ? "vertical" : "horizontal"}
        onMouseDown={handleDividerMouseDown}
        className={cn(
          "split-pane-divider shrink-0 bg-[var(--cg-border,#d4d4d8)] z-10 transition-colors",
          "hover:bg-[var(--cg-active,#a1a1aa)]",
          isVertical
            ? "w-1 h-full cursor-col-resize"
            : "h-1 w-full cursor-row-resize",
        )}
      />

      {/* Secondary pane */}
      <div className="split-pane-secondary" style={secondaryStyle}>
        {children[1]}
      </div>
    </div>
  );
}
