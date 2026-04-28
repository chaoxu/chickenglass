/**
 * Breadcrumbs React component.
 *
 * Transparent overlay that shows the heading ancestry for the topmost
 * visible heading. Fades in/out based on scrollTop changes.
 * Auto-hides 2 s after the last scroll, re-appears on hover.
 *
 * Performance: ancestry is derived from viewportFrom via a Zustand
 * subscription and only triggers React re-renders when the heading
 * chain actually changes. Visibility is driven by an explicit reducer
 * so the hover/scroll policy has one owner.
 */

import { Fragment, useState, useEffect, useRef, useCallback, useReducer } from "react";
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

export interface BreadcrumbVisibilityState {
  visibility: "hidden" | "visible";
  instant: boolean;
  hovered: boolean;
  pendingReveal: boolean;
}

export type BreadcrumbVisibilityEvent =
  | { type: "scroll-with-ancestry" }
  | { type: "scroll-without-ancestry" }
  | { type: "ancestry-available" }
  | { type: "ancestry-cleared" }
  | { type: "hover-start" }
  | { type: "hover-end" }
  | { type: "hide" };

export const INITIAL_BREADCRUMB_VISIBILITY_STATE: BreadcrumbVisibilityState = {
  visibility: "hidden",
  instant: true,
  hovered: false,
  pendingReveal: false,
};

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

export function reduceBreadcrumbVisibility(
  state: BreadcrumbVisibilityState,
  event: BreadcrumbVisibilityEvent,
): BreadcrumbVisibilityState {
  switch (event.type) {
    case "scroll-with-ancestry":
      if (state.visibility === "visible" && !state.instant && !state.pendingReveal) {
        return state;
      }
      return {
        ...state,
        visibility: "visible",
        instant: false,
        pendingReveal: false,
      };
    case "scroll-without-ancestry":
      if (state.visibility === "hidden" && state.instant && state.pendingReveal) {
        return state;
      }
      return {
        ...state,
        visibility: "hidden",
        instant: true,
        pendingReveal: true,
      };
    case "ancestry-available":
      if (!state.pendingReveal) {
        return state;
      }
      return {
        ...state,
        visibility: "visible",
        instant: false,
        pendingReveal: false,
      };
    case "ancestry-cleared":
      if (
        state.visibility === "hidden"
        && state.instant
        && !state.hovered
        && !state.pendingReveal
      ) {
        return state;
      }
      return {
        visibility: "hidden",
        instant: true,
        hovered: false,
        pendingReveal: false,
      };
    case "hover-start":
      if (state.hovered && state.visibility === "visible" && !state.instant) {
        return state;
      }
      return {
        ...state,
        hovered: true,
        visibility: "visible",
        instant: false,
        pendingReveal: false,
      };
    case "hover-end":
      if (!state.hovered) {
        return state;
      }
      return {
        ...state,
        hovered: false,
      };
    case "hide":
      if (state.hovered || state.visibility === "hidden") {
        return state;
      }
      return {
        ...state,
        visibility: "hidden",
        instant: false,
        pendingReveal: false,
      };
  }
}

function useBreadcrumbVisibility(hasAncestry: boolean) {
  const [state, dispatch] = useReducer(
    reduceBreadcrumbVisibility,
    INITIAL_BREADCRUMB_VISIBILITY_STATE,
  );
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      dispatch({ type: "hide" });
    }, FADE_DELAY_MS);
  }, [clearHideTimer]);

  useEffect(() => {
    const unsub = useEditorTelemetryStore.subscribe((store, prev) => {
      if (store.scrollTop === prev.scrollTop) {
        return;
      }

      if (!hasAncestry) {
        clearHideTimer();
        dispatch({ type: "scroll-without-ancestry" });
        return;
      }

      dispatch({ type: "scroll-with-ancestry" });
      if (!state.hovered) {
        scheduleHide();
      }
    });

    return unsub;
  }, [clearHideTimer, hasAncestry, scheduleHide, state.hovered]);

  useEffect(() => {
    return () => {
      clearHideTimer();
    };
  }, [clearHideTimer]);

  useEffect(() => {
    if (!hasAncestry) {
      clearHideTimer();
      dispatch({ type: "ancestry-cleared" });
      return;
    }

    if (!state.pendingReveal) {
      return;
    }

    dispatch({ type: "ancestry-available" });
    if (!state.hovered) {
      scheduleHide();
    }
  }, [clearHideTimer, hasAncestry, scheduleHide, state.hovered, state.pendingReveal]);

  const handleMouseEnter = useCallback(() => {
    clearHideTimer();
    dispatch({ type: "hover-start" });
  }, [clearHideTimer]);

  const handleMouseLeave = useCallback(() => {
    dispatch({ type: "hover-end" });
    if (hasAncestry) {
      scheduleHide();
    }
  }, [hasAncestry, scheduleHide]);

  return {
    visibilityState: state,
    handleMouseEnter,
    handleMouseLeave,
  };
}

export function Breadcrumbs({ headings, onSelect }: BreadcrumbsProps) {
  // Ancestry: only causes React re-renders when the heading chain changes.
  const [ancestry, setAncestry] = useState<HeadingEntry[]>([]);

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

  const {
    visibilityState,
    handleMouseEnter,
    handleMouseLeave,
  } = useBreadcrumbVisibility(ancestry.length > 0);

  if (ancestry.length === 0) {
    return null;
  }

  return (
    <div
      className={[
        "absolute top-0 left-0 z-[100]",
        CSS.breadcrumbs,
        visibilityState.visibility === "visible" ? CSS.breadcrumbsVisible : CSS.breadcrumbsHidden,
        visibilityState.instant ? CSS.breadcrumbsInstant : null,
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
