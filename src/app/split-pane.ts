/**
 * Split-pane module for side-by-side document editing.
 *
 * Provides a `SplitPane` component that manages two editor containers
 * separated by a draggable divider.  Each pane can independently hold a tab
 * bar and an editor view.
 *
 * Supported orientations:
 *   - "vertical"   — left pane | right pane  (divider is a vertical bar)
 *   - "horizontal" — top pane / bottom pane  (divider is a horizontal bar)
 *
 * Usage
 * -----
 * ```ts
 * const split = new SplitPane({ orientation: "vertical" });
 * document.body.appendChild(split.element);
 *
 * // Each pane exposes a container where a tab bar + editor can be mounted.
 * const primaryContainer = split.primaryPane;
 * const secondaryContainer = split.secondaryPane;
 *
 * // Close the secondary pane to collapse back to single-pane mode.
 * split.closeSecondaryPane();
 *
 * // Listen for size changes.
 * split.onResize = (primarySize, secondarySize) => { ... };
 * ```
 */

/** Orientation of the split: two columns vs two rows. */
export type SplitOrientation = "vertical" | "horizontal";

/** Configuration passed to the `SplitPane` constructor. */
export interface SplitPaneConfig {
  /**
   * Split orientation.
   * "vertical"   = left | right (default)
   * "horizontal" = top / bottom
   */
  orientation?: SplitOrientation;

  /**
   * Initial primary pane size as a fraction of the total (0–1).
   * Defaults to 0.5 (equal split).
   */
  initialRatio?: number;

  /**
   * Minimum size in pixels for each pane.
   * Defaults to 120.
   */
  minPaneSize?: number;
}

/** Callback invoked after the divider is moved. */
export type ResizeCallback = (primaryPx: number, secondaryPx: number) => void;

/**
 * A container split into two independently scrollable panes with a draggable
 * divider.  Both panes fill the available space; the divider controls the
 * ratio between them.
 *
 * The secondary pane can be hidden via `closeSecondaryPane()` to return to
 * single-pane layout without destroying the DOM.
 */
export class SplitPane {
  /** Root element — add this to the document. */
  readonly element: HTMLElement;

  /** Container element for the primary (left / top) pane content. */
  readonly primaryPane: HTMLElement;

  /** Container element for the secondary (right / bottom) pane content. */
  readonly secondaryPane: HTMLElement;

  /** The draggable divider element. */
  readonly divider: HTMLElement;

  /** Callback invoked after the user finishes a drag or programmatic resize. */
  onResize: ResizeCallback | null = null;

  private orientation: SplitOrientation;
  private readonly minPaneSize: number;
  /** Current ratio: fraction of total allocated to the primary pane. */
  private ratio: number;
  private secondaryVisible = true;

  // Drag state
  private dragging = false;
  private dragStartPos = 0;
  private dragStartRatio = 0;
  /** Total container size cached at drag-start to avoid per-mousemove reflows. */
  private dragTotalSize = 0;

  private readonly onMouseDown: (e: MouseEvent) => void;
  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onMouseUp: (e: MouseEvent) => void;
  private readonly onTouchStart: (e: TouchEvent) => void;
  private readonly onTouchMove: (e: TouchEvent) => void;
  private readonly onTouchEnd: (e: TouchEvent) => void;

  constructor(config: SplitPaneConfig = {}) {
    this.orientation = config.orientation ?? "vertical";
    this.ratio = Math.max(0, Math.min(1, config.initialRatio ?? 0.5));
    this.minPaneSize = config.minPaneSize ?? 120;

    // Root element
    this.element = document.createElement("div");
    this.element.className = `split-pane split-pane-${this.orientation}`;
    applyRootStyles(this.element, this.orientation);

    // Primary pane
    this.primaryPane = document.createElement("div");
    this.primaryPane.className = "split-pane-primary";
    applyPaneStyles(this.primaryPane);

    // Divider — hover highlight wired once here, never re-added on orientation change.
    this.divider = document.createElement("div");
    this.divider.className = `split-pane-divider split-pane-divider-${this.orientation}`;
    applyDividerStyles(this.divider, this.orientation);
    this.divider.addEventListener("mouseenter", () => {
      this.divider.style.background = "var(--cg-active, #d4d4d8)";
    });
    this.divider.addEventListener("mouseleave", () => {
      this.divider.style.background = "var(--cg-border, #d4d4d8)";
    });

    // Secondary pane
    this.secondaryPane = document.createElement("div");
    this.secondaryPane.className = "split-pane-secondary";
    applyPaneStyles(this.secondaryPane);

    this.element.appendChild(this.primaryPane);
    this.element.appendChild(this.divider);
    this.element.appendChild(this.secondaryPane);

    // Bind persistent handlers once so they can be removed in destroy().
    this.onMouseDown = this.handleMouseDown.bind(this);
    this.onMouseMove = this.handleMouseMove.bind(this);
    this.onMouseUp = this.handleMouseUp.bind(this);
    this.onTouchStart = this.handleTouchStart.bind(this);
    this.onTouchMove = this.handleTouchMove.bind(this);
    this.onTouchEnd = this.handleTouchEnd.bind(this);

    this.divider.addEventListener("mousedown", this.onMouseDown);
    this.divider.addEventListener("touchstart", this.onTouchStart, { passive: true });

    // Apply initial layout after the element is fully constructed.
    this.applyRatio();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Return whether the secondary pane is currently visible. */
  isSecondaryVisible(): boolean {
    return this.secondaryVisible;
  }

  /**
   * Show the secondary pane if it is currently hidden.
   * The ratio is restored to the last value used before hiding.
   */
  showSecondaryPane(): void {
    if (this.secondaryVisible) return;
    this.secondaryVisible = true;
    this.secondaryPane.style.display = "";
    this.divider.style.display = "";
    this.applyRatio();
  }

  /**
   * Hide the secondary pane, giving the full space to the primary pane.
   * The divider is also hidden.  The DOM for the secondary pane is preserved
   * so it can be re-shown without re-mounting the editor.
   */
  closeSecondaryPane(): void {
    if (!this.secondaryVisible) return;
    this.secondaryVisible = false;
    this.secondaryPane.style.display = "none";
    this.divider.style.display = "none";
    this.primaryPane.style.flex = "1 1 0";
    // Clear whichever min-size dimension the current orientation uses.
    if (this.orientation === "vertical") {
      this.primaryPane.style.minWidth = "";
    } else {
      this.primaryPane.style.minHeight = "";
    }
    this.notifyResize(this.totalSize());
  }

  /**
   * Programmatically set the split ratio (0–1 where 1 = primary takes all).
   * Clamps to ensure each pane stays above minPaneSize when both are visible.
   */
  setRatio(ratio: number): void {
    this.ratio = ratio;
    if (this.secondaryVisible) this.applyRatio();
  }

  /** Return the current split ratio. */
  getRatio(): number {
    return this.ratio;
  }

  /**
   * Change the orientation dynamically.  Existing pane content is preserved.
   */
  setOrientation(orientation: SplitOrientation): void {
    if (orientation === this.orientation) return;

    this.element.classList.remove(`split-pane-${this.orientation}`);
    this.divider.classList.remove(`split-pane-divider-${this.orientation}`);

    this.orientation = orientation;

    this.element.classList.add(`split-pane-${this.orientation}`);
    this.divider.classList.add(`split-pane-divider-${this.orientation}`);

    // Re-apply only orientation-dependent styles (hover listeners are not touched).
    applyRootStyles(this.element, this.orientation);
    applyDividerStyles(this.divider, this.orientation);

    if (this.secondaryVisible) this.applyRatio();
  }

  /**
   * Remove all event listeners and clean up.  Does not detach from the DOM.
   */
  destroy(): void {
    this.stopDrag();
    this.divider.removeEventListener("mousedown", this.onMouseDown);
    this.divider.removeEventListener("touchstart", this.onTouchStart);
  }

  // ---------------------------------------------------------------------------
  // Mouse drag
  // ---------------------------------------------------------------------------

  private handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return; // primary button only
    e.preventDefault();
    this.startDrag(this.orientation === "vertical" ? e.clientX : e.clientY);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mouseup", this.onMouseUp);
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.dragging) return;
    this.updateDrag(this.orientation === "vertical" ? e.clientX : e.clientY);
  }

  private handleMouseUp(_e: MouseEvent): void {
    this.stopDrag();
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mouseup", this.onMouseUp);
  }

  // ---------------------------------------------------------------------------
  // Touch drag
  // ---------------------------------------------------------------------------

  private handleTouchStart(e: TouchEvent): void {
    const touch = e.touches[0];
    if (!touch) return;
    this.startDrag(this.orientation === "vertical" ? touch.clientX : touch.clientY);
    document.addEventListener("touchmove", this.onTouchMove, { passive: false });
    document.addEventListener("touchend", this.onTouchEnd);
  }

  private handleTouchMove(e: TouchEvent): void {
    if (!this.dragging) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    this.updateDrag(this.orientation === "vertical" ? touch.clientX : touch.clientY);
  }

  private handleTouchEnd(_e: TouchEvent): void {
    this.stopDrag();
    document.removeEventListener("touchmove", this.onTouchMove);
    document.removeEventListener("touchend", this.onTouchEnd);
  }

  // ---------------------------------------------------------------------------
  // Drag core
  // ---------------------------------------------------------------------------

  private startDrag(pos: number): void {
    this.dragging = true;
    this.dragStartPos = pos;
    this.dragStartRatio = this.ratio;
    // Cache total size once at drag-start to avoid reflow on every mousemove.
    this.dragTotalSize = this.totalSize();
    this.element.style.cursor = this.orientation === "vertical" ? "col-resize" : "row-resize";
    this.element.style.userSelect = "none";
  }

  private updateDrag(pos: number): void {
    const total = this.dragTotalSize;
    if (total <= 0) return;

    const delta = pos - this.dragStartPos;
    const newRatio = this.dragStartRatio + delta / total;
    this.ratio = clampRatio(newRatio, total, this.minPaneSize);
    this.applyRatio();
  }

  private stopDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.element.style.cursor = "";
    this.element.style.userSelect = "";
    this.notifyResize(this.totalSize());
  }

  // ---------------------------------------------------------------------------
  // Layout helpers
  // ---------------------------------------------------------------------------

  private totalSize(): number {
    const rect = this.element.getBoundingClientRect();
    return this.orientation === "vertical" ? rect.width : rect.height;
  }

  private applyRatio(): void {
    const primary = `calc(${(this.ratio * 100).toFixed(4)}% - ${DIVIDER_SIZE / 2}px)`;
    const secondary = `calc(${((1 - this.ratio) * 100).toFixed(4)}% - ${DIVIDER_SIZE / 2}px)`;
    const minSize = `${this.minPaneSize}px`;

    setPaneSize(this.primaryPane, this.orientation, primary, minSize);
    setPaneSize(this.secondaryPane, this.orientation, secondary, minSize);

    // applyRatio is only called when secondaryVisible; pass cached or live total.
    const total = this.dragging ? this.dragTotalSize : this.totalSize();
    this.notifyResize(total);
  }

  private notifyResize(total: number): void {
    if (!this.onResize) return;
    if (!this.secondaryVisible) {
      this.onResize(total, 0);
      return;
    }
    this.onResize(
      total * this.ratio - DIVIDER_SIZE / 2,
      total * (1 - this.ratio) - DIVIDER_SIZE / 2,
    );
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Width/height of the draggable divider in pixels. */
const DIVIDER_SIZE = 4;

// ---------------------------------------------------------------------------
// Style helpers (applied in JS so the module is CSS-free)
// ---------------------------------------------------------------------------

function applyRootStyles(el: HTMLElement, orientation: SplitOrientation): void {
  el.style.display = "flex";
  el.style.flexDirection = orientation === "vertical" ? "row" : "column";
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.overflow = "hidden";
  el.style.position = "relative";
}

function applyPaneStyles(el: HTMLElement): void {
  el.style.overflow = "hidden";
  el.style.position = "relative";
  el.style.display = "flex";
  el.style.flexDirection = "column";
}

/** Apply orientation-dependent size/cursor styles to the divider bar. */
function applyDividerStyles(el: HTMLElement, orientation: SplitOrientation): void {
  el.style.flexShrink = "0";
  el.style.background = "var(--cg-border, #d4d4d8)";
  el.style.zIndex = "10";
  el.style.transition = "background 0.15s";

  if (orientation === "vertical") {
    el.style.width = `${DIVIDER_SIZE}px`;
    el.style.height = "100%";
    el.style.cursor = "col-resize";
  } else {
    el.style.height = `${DIVIDER_SIZE}px`;
    el.style.width = "100%";
    el.style.cursor = "row-resize";
  }
}

/**
 * Apply the computed size string and minimum size to a pane element,
 * clearing the orthogonal dimension so it fills its flex container.
 */
function setPaneSize(
  el: HTMLElement,
  orientation: SplitOrientation,
  size: string,
  minSize: string,
): void {
  el.style.flex = "";
  if (orientation === "vertical") {
    el.style.width = size;
    el.style.height = "100%";
    el.style.minWidth = minSize;
    el.style.minHeight = "";
  } else {
    el.style.height = size;
    el.style.width = "100%";
    el.style.minHeight = minSize;
    el.style.minWidth = "";
  }
}

/** Clamp ratio so each pane is at least minPaneSize pixels. */
function clampRatio(ratio: number, total: number, minPaneSize: number): number {
  const available = total - DIVIDER_SIZE;
  const minFrac = minPaneSize / available;
  return Math.max(minFrac, Math.min(1 - minFrac, ratio));
}
