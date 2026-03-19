/**
 * Scroll-tracking breadcrumb overlay for the editor.
 *
 * Displays the heading hierarchy at the top of the visible viewport as
 * a semi-transparent overlay that floats above the editor content.
 * Clicking a breadcrumb segment scrolls to that heading.
 *
 * Behavior:
 * - Updates based on scroll position (top visible heading's ancestry)
 * - Semi-transparent background with backdrop blur
 * - Fades in on scroll and reappears on hover
 * - Auto-fades out 2 s after the last scroll event
 * - Hidden entirely when at the top of the document (no ancestor headings)
 * - Smooth opacity transition
 *
 * Implemented as a CM6 ViewPlugin that appends an absolutely-positioned
 * overlay to the editor's root element (`.cm-editor`), which CM6 already
 * styles with `position: relative`. The overlay sits above the scrolling
 * content without disrupting the editor layout.
 */

import { type Extension } from "@codemirror/state";
import {
  EditorView,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import {
  extractHeadings,
  headingAncestryAt,
  type HeadingEntry,
} from "./heading-ancestry";

/** Milliseconds after the last scroll event before the overlay fades out. */
const FADE_DELAY_MS = 2000;

/** Render breadcrumb segments into the inner bar element. */
function renderBreadcrumbs(
  bar: HTMLElement,
  ancestry: ReadonlyArray<HeadingEntry>,
  view: EditorView,
): void {
  bar.innerHTML = "";

  for (let i = 0; i < ancestry.length; i++) {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "cg-bc-sep";
      sep.textContent = "›";
      sep.setAttribute("aria-hidden", "true");
      bar.appendChild(sep);
    }

    const segment = document.createElement("span");
    segment.className = "cg-bc-seg";
    segment.textContent = ancestry[i].text;
    segment.title = ancestry[i].text;

    const pos = ancestry[i].pos;
    segment.addEventListener("click", () => {
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    });

    bar.appendChild(segment);
  }
}

class BreadcrumbPlugin implements PluginValue {
  /** Outer wrapper with absolute positioning; handles opacity transitions. */
  private readonly overlay: HTMLElement;
  /** Inner bar that contains the breadcrumb segments. */
  private readonly bar: HTMLElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAncestry: ReadonlyArray<HeadingEntry> = [];

  constructor(private readonly view: EditorView) {
    this.overlay = document.createElement("div");
    this.overlay.className = "cg-bc-overlay cg-bc-hidden cg-bc-instant";

    this.bar = document.createElement("div");
    this.bar.className = "cg-bc-bar";
    this.overlay.appendChild(this.bar);

    // Keep the overlay visible while hovering over it.
    this.overlay.addEventListener("mouseenter", () => {
      this.onMouseEnter();
    });
    this.overlay.addEventListener("mouseleave", () => {
      this.scheduleHide();
    });

    // Append to the CM6 editor root (position: relative), not the scroller.
    // This makes the overlay float above the scrolled content.
    this.view.dom.appendChild(this.overlay);

    // Compute initial state without triggering a scroll-show.
    this.updateAncestry(false);
  }

  update(update: ViewUpdate): void {
    const scrolled = update.viewportChanged;
    const changed = scrolled || update.docChanged || update.geometryChanged;
    if (!changed) return;

    this.updateAncestry(scrolled);
  }

  /** Recompute the heading ancestry and manage visibility. */
  private updateAncestry(causedByScroll: boolean): void {
    const headings = extractHeadings(this.view.state);
    // Use the document position at the top of the current viewport.
    const topPos = this.view.viewport.from;
    const ancestry = headingAncestryAt(headings, topPos);

    // Only redraw DOM if the ancestry actually changed.
    const same =
      ancestry.length === this.lastAncestry.length &&
      ancestry.every((h, i) => h.pos === this.lastAncestry[i].pos);

    if (!same) {
      this.lastAncestry = ancestry;
      renderBreadcrumbs(this.bar, ancestry, this.view);
    }

    if (ancestry.length === 0) {
      // No heading above the viewport — hide immediately, cancel any pending hide.
      this.clearTimer();
      this.hide(true);
    } else if (causedByScroll) {
      // User scrolled — show and schedule auto-hide.
      this.show();
      this.scheduleHide();
    }
    // If not caused by scroll (initial / doc change), keep current visibility.
  }

  /** Returns true when the overlay is currently shown. */
  private get isVisible(): boolean {
    return !this.overlay.classList.contains("cg-bc-hidden");
  }

  /** Make the overlay visible; pass instant=true to skip the fade-in. */
  private show(instant = false): void {
    this.overlay.classList.remove("cg-bc-hidden");
    if (instant) {
      this.overlay.classList.add("cg-bc-instant");
    } else {
      this.overlay.classList.remove("cg-bc-instant");
    }
  }

  /** Hide the overlay; pass instant=true to skip the fade-out transition. */
  private hide(instant = false): void {
    this.overlay.classList.add("cg-bc-hidden");
    if (instant) {
      this.overlay.classList.add("cg-bc-instant");
    } else {
      this.overlay.classList.remove("cg-bc-instant");
    }
  }

  private scheduleHide(): void {
    this.clearTimer();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.hide(false);
    }, FADE_DELAY_MS);
  }

  /** Cancel a pending hide timer without any side effects. */
  private clearTimer(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  /** On mouseenter: cancel the pending hide and restore visibility if needed. */
  private onMouseEnter(): void {
    this.clearTimer();
    if (!this.isVisible && this.lastAncestry.length > 0) {
      this.show(false);
    }
  }

  destroy(): void {
    this.clearTimer();
    this.overlay.remove();
  }
}

/** Styles injected once into the document head. */
const OVERLAY_STYLES = `
/* Overlay wrapper — absolutely positioned at top of .cm-editor */
.cg-bc-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  pointer-events: none;
  opacity: 1;
  transition: opacity 0.3s ease;
}

/* Instant class suppresses the fade transition */
.cg-bc-overlay.cg-bc-instant {
  transition: none;
}

/* Hidden state — just zero opacity, keeps layout position */
.cg-bc-overlay.cg-bc-hidden {
  opacity: 0;
  pointer-events: none;
}

/* Visible state re-enables pointer events on the inner bar */
.cg-bc-overlay:not(.cg-bc-hidden) {
  pointer-events: auto;
}

/* The semi-transparent bar */
.cg-bc-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 12px;
  font-size: 12px;
  color: var(--cg-muted, #71717a);
  background: var(--cg-bg-overlay, rgba(255, 255, 255, 0.82));
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--cg-border-overlay, rgba(212, 212, 216, 0.6));
  white-space: nowrap;
  overflow: hidden;
  min-height: 24px;
}

/* Separator between segments */
.cg-bc-sep {
  color: var(--cg-separator, rgba(161, 161, 170, 0.8));
  margin: 0 2px;
  flex-shrink: 0;
  user-select: none;
}

/* Individual segment */
.cg-bc-seg {
  cursor: pointer;
  color: var(--cg-muted, #71717a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 2px;
  padding: 1px 4px;
  max-width: 200px;
}

.cg-bc-seg:hover {
  background: var(--cg-hover, #e4e4e7);
  color: var(--cg-fg, #09090b);
}

/* Innermost (last) segment is emphasised */
.cg-bc-seg:last-child {
  color: var(--cg-fg, #09090b);
  font-weight: 500;
}
`;

/** Inject the breadcrumb styles into the document head (once). */
function injectStyles(): void {
  if (document.getElementById("cg-breadcrumb-styles")) return;
  const style = document.createElement("style");
  style.id = "cg-breadcrumb-styles";
  style.textContent = OVERLAY_STYLES;
  document.head.appendChild(style);
}

// Run at module load — safe because this module only runs in a browser context.
injectStyles();

/** CM6 extension: floating breadcrumb overlay that tracks scroll position. */
export const breadcrumbExtension: Extension = ViewPlugin.fromClass(BreadcrumbPlugin);
