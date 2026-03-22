/**
 * Breadcrumbs React component.
 *
 * Transparent overlay that shows the heading ancestry for the topmost
 * visible heading. Fades in/out based on scrollTop changes.
 * Auto-hides 2 s after the last scroll, re-appears on hover.
 */

import { Fragment, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cn } from "../lib/utils";
import { headingAncestryAt, type HeadingEntry } from "../heading-ancestry";
import { renderInline } from "../markdown-to-html";
import {
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";

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
        !instant && "transition-opacity duration-[var(--cf-transition,0.15s)]",
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
      <Breadcrumb className="overflow-x-auto rounded-br border border-[var(--cf-border)] bg-[var(--cf-bg)]/80 px-3 py-1 backdrop-blur-sm">
        <BreadcrumbList className="min-w-max flex-nowrap whitespace-nowrap">
          {ancestry.map((h, i) => (
            <Fragment key={h.pos}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {i === ancestry.length - 1 ? (
                  <BreadcrumbPage
                    title={h.text}
                    dangerouslySetInnerHTML={{ __html: renderInline(h.text, undefined, "ui-chrome-inline") }}
                  />
                ) : (
                  <BreadcrumbButton
                    title={h.text}
                    onClick={() => onSelect(h.pos)}
                    dangerouslySetInnerHTML={{ __html: renderInline(h.text, undefined, "ui-chrome-inline") }}
                  />
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
