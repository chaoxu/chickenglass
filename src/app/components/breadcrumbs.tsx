/**
 * Breadcrumbs React component.
 *
 * Transparent overlay that shows the heading ancestry for the topmost
 * visible heading. Fades in/out based on scrollTop changes.
 * Auto-hides 2 s after the last scroll, re-appears on hover.
 *
 * Performance: ancestry is derived from viewportFrom via a Zustand
 * subscription and only triggers React re-renders when the heading
 * chain actually changes. Fade/show timing runs off the React render
 * path via direct DOM updates, so ordinary scroll ticks produce no
 * React work.
 */

import { Fragment, useState, useEffect, useRef, useCallback } from "react";
import { headingAncestryAt, type HeadingEntry } from "../heading-ancestry";
import { useEditorTelemetryStore } from "../stores/editor-telemetry-store";
import { HeadingLabel } from "./heading-chrome";
import { CSS } from "../../constants/css-classes";
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
}

/** Milliseconds to wait after last scroll before fading out. */
const FADE_DELAY_MS = 2000;

/** Compare ancestry arrays by all heading fields (pos, level, text, number). */
export function ancestryEqual(a: HeadingEntry[], b: HeadingEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].pos !== b[i].pos ||
      a[i].level !== b[i].level ||
      a[i].text !== b[i].text ||
      a[i].number !== b[i].number
    ) return false;
  }
  return true;
}

/** Apply visibility classes directly to the container element (no React). */
export function applyBreadcrumbVisibility(el: HTMLDivElement, visible: boolean, instant: boolean): void {
  el.classList.toggle(CSS.breadcrumbsVisible, visible);
  el.classList.toggle(CSS.breadcrumbsHidden, !visible);
  el.classList.toggle(CSS.breadcrumbsInstant, instant);
}

export function Breadcrumbs({ headings, onSelect }: BreadcrumbsProps) {
  // Ancestry: only causes React re-renders when the heading chain changes.
  const [ancestry, setAncestry] = useState<HeadingEntry[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredRef = useRef(false);
  // Ref mirrors for use in non-React callbacks.
  const ancestryLenRef = useRef(0);
  ancestryLenRef.current = ancestry.length;
  const visibleRef = useRef(false);
  // Flag: a scroll event fired but containerRef was null (component was
  // returning null). The mount-recovery effect picks this up.
  const pendingShowRef = useRef(false);

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
      const el = containerRef.current;
      if (el && !hoveredRef.current) {
        visibleRef.current = false;
        applyBreadcrumbVisibility(el, false, false);
      }
    }, FADE_DELAY_MS);
  }, [clearTimer]);

  // Ancestry subscription: recompute only when viewportFrom changes,
  // and only update React state when the heading chain differs.
  useEffect(() => {
    const computeAndSet = (viewportFrom: number) => {
      const next = headingAncestryAt(headings, viewportFrom);
      setAncestry((prev) => (ancestryEqual(prev, next) ? prev : next));
    };

    computeAndSet(useEditorTelemetryStore.getState().viewportFrom);

    const unsub = useEditorTelemetryStore.subscribe((state, prev) => {
      if (state.viewportFrom !== prev.viewportFrom) {
        computeAndSet(state.viewportFrom);
      }
    });

    return unsub;
  }, [headings]);

  // Scroll visibility: respond to scrollTop changes via direct DOM
  // updates — no React state, no re-renders.
  useEffect(() => {
    const unsub = useEditorTelemetryStore.subscribe((state, prev) => {
      if (state.scrollTop === prev.scrollTop) return;

      const el = containerRef.current;
      if (!el) {
        // Container not mounted — ancestry may be transitioning from
        // empty to non-empty. Flag so the mount-recovery effect can
        // show the breadcrumb after React commits the new ancestry.
        pendingShowRef.current = true;
        return;
      }

      pendingShowRef.current = false;

      if (ancestryLenRef.current === 0) {
        clearTimer();
        visibleRef.current = false;
        applyBreadcrumbVisibility(el, false, true);
        return;
      }

      visibleRef.current = true;
      applyBreadcrumbVisibility(el, true, false);
      if (!hoveredRef.current) scheduleHide();
    });

    return () => {
      unsub();
      clearTimer();
    };
  }, [clearTimer, scheduleHide]);

  // Mount recovery: when ancestry transitions from empty to non-empty,
  // the scroll subscriber that caused it found containerRef null and
  // set pendingShowRef. Now that React has committed the container,
  // make it visible.
  useEffect(() => {
    if (ancestry.length === 0 || !pendingShowRef.current) return;
    pendingShowRef.current = false;
    const el = containerRef.current;
    if (!el) return;
    visibleRef.current = true;
    applyBreadcrumbVisibility(el, true, false);
    if (!hoveredRef.current) scheduleHide();
  }, [ancestry, scheduleHide]);

  const handleMouseEnter = useCallback(() => {
    hoveredRef.current = true;
    clearTimer();
    const el = containerRef.current;
    if (el && ancestryLenRef.current > 0) {
      visibleRef.current = true;
      applyBreadcrumbVisibility(el, true, false);
    }
  }, [clearTimer]);

  const handleMouseLeave = useCallback(() => {
    hoveredRef.current = false;
    scheduleHide();
  }, [scheduleHide]);

  // Reset visibility when ancestry empties (component is about to return null).
  if (ancestry.length === 0) {
    visibleRef.current = false;
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={[
        "absolute top-0 left-0 z-[100]",
        CSS.breadcrumbs,
        visibleRef.current ? CSS.breadcrumbsVisible : CSS.breadcrumbsHidden,
      ].join(" ")}
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
                  <BreadcrumbPage>
                    <HeadingLabel text={h.text} />
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbButton onClick={() => onSelect(h.pos)}>
                    <HeadingLabel text={h.text} />
                  </BreadcrumbButton>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
