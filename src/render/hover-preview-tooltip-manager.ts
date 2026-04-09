import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { CSS } from "../constants";
import { createPreviewSurfaceShell } from "../preview-surface";

/**
 * Owns the hover preview tooltip lifecycle for a single editor instance.
 */
export class HoverPreviewTooltipManager {
  private tooltipEl: HTMLDivElement | null = null;
  private cleanupAutoUpdate: (() => void) | null = null;
  private currentFloatingAnchor: HTMLElement | null = null;
  private refreshFloatingPosition: (() => void) | null = null;
  private showGeneration = 0;

  public show(anchor: HTMLElement, content: HTMLElement): void {
    const el = this.getTooltipEl();
    const anchorChanged = anchor !== this.currentFloatingAnchor;

    if (anchorChanged) {
      this.cleanupPositionTracking();

      this.currentFloatingAnchor = anchor;
      const generation = ++this.showGeneration;

      const updatePosition = () => {
        void computePosition(anchor, el, {
          placement: "top",
          middleware: [offset(6), flip(), shift({ padding: 5 })],
        }).then(({ x, y }) => {
          if (generation !== this.showGeneration) return;

          Object.assign(el.style, {
            left: `${x}px`,
            top: `${y}px`,
          });
        });
      };

      this.refreshFloatingPosition = updatePosition;
      this.cleanupAutoUpdate = autoUpdate(anchor, el, updatePosition);
    }

    if (el.firstElementChild !== content) {
      el.replaceChildren(content);
    }

    const wasHidden = el.style.display === "none";
    el.style.display = "";
    if (wasHidden) {
      el.setAttribute("data-visible", "false");
    }

    this.refreshFloatingPosition?.();

    if (wasHidden) {
      const visibleGeneration = this.showGeneration;
      requestAnimationFrame(() => {
        if (visibleGeneration === this.showGeneration) {
          el.setAttribute("data-visible", "true");
        }
      });
      return;
    }

    el.setAttribute("data-visible", "true");
  }

  public hide(): void {
    this.cleanupPositionTracking();
    this.currentFloatingAnchor = null;
    this.showGeneration += 1;
    if (!this.tooltipEl) return;
    this.tooltipEl.setAttribute("data-visible", "false");
    this.tooltipEl.style.display = "none";
  }

  public destroy(): void {
    this.hide();
    this.tooltipEl?.remove();
    this.tooltipEl = null;
  }

  public contains(target: Node | null): boolean {
    return target !== null && this.tooltipEl?.contains(target) === true;
  }

  public isVisible(): boolean {
    return this.tooltipEl !== null && this.tooltipEl.style.display !== "none";
  }

  public ensureTooltipElementForTest(): HTMLDivElement {
    return this.getTooltipEl();
  }

  private getTooltipEl(): HTMLDivElement {
    if (!this.tooltipEl) {
      this.tooltipEl = createPreviewSurfaceShell(CSS.hoverPreviewTooltip);
      this.tooltipEl.style.display = "none";
      document.body.appendChild(this.tooltipEl);
    }
    return this.tooltipEl;
  }

  private cleanupPositionTracking(): void {
    if (this.cleanupAutoUpdate) {
      this.cleanupAutoUpdate();
      this.cleanupAutoUpdate = null;
    }
    this.refreshFloatingPosition = null;
  }
}
