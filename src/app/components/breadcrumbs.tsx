/**
 * Breadcrumbs React component.
 *
 * Transparent overlay that shows the heading ancestry for the topmost
 * visible heading. Fades in/out based on scrollTop changes.
 * Auto-hides 2 s after the last scroll, re-appears on hover.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cn } from "../lib/utils";
import { headingAncestryAt, type HeadingEntry } from "../heading-ancestry";

interface BreadcrumbsProps {
  /** All headings extracted from the document. */
  headings: HeadingEntry[];
  /** Called when the user clicks a breadcrumb segment. */
  onSelect: (from: number) => void;
  /** Current scroll offset of the editor scroller (pixels from top). */
  scrollTop: number;
  /**
   * Document position at the top of the visible viewport.
   * Used to compute ancestry; updated by the parent on scroll.
   */
  viewportFrom: number;
}

/** Milliseconds to wait after last scroll before fading out. */
const FADE_DELAY_MS = 2000;

export function Breadcrumbs({ headings, onSelect, scrollTop, viewportFrom }: BreadcrumbsProps) {
  const ancestry = useMemo(() => headingAncestryAt(headings, viewportFrom), [headings, viewportFrom]);

  const [visible, setVisible] = useState(false);
  const [instant, setInstant] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevScrollTopRef = useRef(scrollTop);
  const hoveredRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearTimer();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      if (!hoveredRef.current) setVisible(false);
    }, FADE_DELAY_MS);
  }, [clearTimer]);

  useEffect(() => {
    if (ancestry.length === 0) {
      clearTimer();
      setInstant(true);
      setVisible(false);
      return clearTimer;
    }

    const didScroll = scrollTop !== prevScrollTopRef.current;
    prevScrollTopRef.current = scrollTop;

    if (didScroll) {
      setInstant(false);
      setVisible(true);
      if (!hoveredRef.current) scheduleHide();
    }

    return clearTimer;
  }, [scrollTop, ancestry.length, scheduleHide, clearTimer]);

  const handleMouseEnter = () => {
    hoveredRef.current = true;
    clearTimer();
    if (ancestry.length > 0) {
      setInstant(false);
      setVisible(true);
    }
  };

  const handleMouseLeave = () => {
    hoveredRef.current = false;
    scheduleHide();
  };

  // Don't render anything when there's no heading ancestry
  if (ancestry.length === 0) return null;

  return (
    <div
      className={cn(
        "absolute top-0 left-0 z-[100]",
        !instant && "transition-opacity duration-[var(--cg-transition,0.15s)]",
        visible ? "opacity-100" : "opacity-0",
      )}
      style={{
        pointerEvents: visible ? "auto" : undefined,
        height: visible ? undefined : "4px",
        overflow: visible ? undefined : "hidden",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="inline-flex items-center gap-0.5 px-3 py-1 text-xs bg-[var(--cg-bg)]/80 backdrop-blur-sm border border-[var(--cg-border)] rounded-br whitespace-nowrap overflow-hidden">
        {ancestry.map((h, i) => (
          <span key={h.pos} className="flex items-center gap-0.5 min-w-0">
            {i > 0 && (
              <span
                className="text-[var(--cg-muted)] opacity-60 mx-0.5 shrink-0 select-none"
                aria-hidden="true"
              >
                ›
              </span>
            )}
            <span
              className={cn(
                "cursor-pointer rounded px-1 py-[1px] max-w-[200px] truncate",
                "text-[var(--cg-muted)] hover:bg-[var(--cg-hover)] hover:text-[var(--cg-fg)]",
                "transition-colors duration-[var(--cg-transition,0.15s)]",
                i === ancestry.length - 1 && "text-[var(--cg-fg)] font-medium",
              )}
              title={h.text}
              onClick={() => onSelect(h.pos)}
            >
              {h.text}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
