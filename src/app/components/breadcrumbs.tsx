/**
 * Breadcrumbs React component.
 *
 * Transparent overlay that shows the heading ancestry for the topmost
 * visible heading. Fades in/out based on scrollTop changes.
 * Auto-hides 2 s after the last scroll, re-appears on hover.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cn } from "../lib/utils";
import { headingAncestryAt } from "../heading-ancestry";

export interface BreadcrumbHeading {
  level: number;
  text: string;
  from: number;
}

interface BreadcrumbsProps {
  /** All headings extracted from the document. */
  headings: BreadcrumbHeading[];
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
  // Memoize the shape conversion and ancestry computation so they don't run on every render.
  const entries = useMemo(
    () => headings.map((h) => ({ level: h.level, text: h.text, number: "", pos: h.from })),
    [headings],
  );
  const ancestry = useMemo(() => headingAncestryAt(entries, viewportFrom), [entries, viewportFrom]);

  // Track visibility: hidden when ancestry is empty, or after the fade timer.
  const [visible, setVisible] = useState(false);
  const [instant, setInstant] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevScrollTopRef = useRef(scrollTop);
  // Ref (not state) — hover doesn't drive rendering, only controls timer scheduling.
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
      setVisible(false);
    }, FADE_DELAY_MS);
  }, [clearTimer]);

  // React to scroll changes and clean up on unmount.
  useEffect(() => {
    if (ancestry.length === 0) {
      clearTimer();
      setInstant(true);
      setVisible(false);
      return clearTimer; // cleanup
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

  return (
    <div
      className={cn(
        "absolute top-0 left-0 right-0 z-[100] pointer-events-none",
        !instant && "transition-opacity duration-300",
        visible ? "opacity-100 pointer-events-auto" : "opacity-0",
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="flex items-center gap-0.5 px-3 py-1 text-xs bg-white/82 backdrop-blur-sm border-b border-zinc-200/60 whitespace-nowrap overflow-hidden min-h-[24px]">
        {ancestry.map((h, i) => (
          <span key={h.pos} className="flex items-center gap-0.5 min-w-0">
            {i > 0 && (
              <span
                className="text-zinc-400/80 mx-0.5 shrink-0 select-none"
                aria-hidden="true"
              >
                ›
              </span>
            )}
            <span
              className={cn(
                "cursor-pointer rounded px-1 py-[1px] max-w-[200px] truncate",
                "text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900",
                i === ancestry.length - 1 && "text-zinc-900 font-medium",
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
