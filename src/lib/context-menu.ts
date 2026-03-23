/**
 * Generic context menu for the editor.
 *
 * No dependency on CM6 or React — safe to import from render/,
 * editor/, and app/.
 */

/** A single item in a context menu. */
export interface ContextMenuItem {
  /** Display label. Use "-" for a separator. */
  label: string;
  /** Action to invoke when the item is clicked. */
  action?: () => void;
  /** Whether the item is disabled. */
  disabled?: boolean;
}

/**
 * Generic context menu that renders near the click point.
 * Dismisses on any outside click or Escape key.
 */
export class ContextMenu {
  private readonly el: HTMLElement;
  private readonly keydownHandler: (e: KeyboardEvent) => void;
  private readonly clickHandler: () => void;

  /**
   * Create and show a context menu.
   *
   * @param items - Menu items to display.
   * @param x - Client X coordinate near which to position the menu.
   * @param y - Client Y coordinate near which to position the menu.
   */
  constructor(items: ContextMenuItem[], x: number, y: number) {
    this.el = document.createElement("div");
    this.el.className = "context-menu";
    this.el.setAttribute("role", "menu");

    for (const item of items) {
      if (item.label === "-") {
        const sep = document.createElement("div");
        sep.className = "context-menu-separator";
        this.el.appendChild(sep);
        continue;
      }

      const el = document.createElement("div");
      el.className = "context-menu-item";
      el.setAttribute("role", "menuitem");
      el.textContent = item.label;

      if (item.disabled) {
        el.classList.add("context-menu-item-disabled");
        el.setAttribute("aria-disabled", "true");
      } else {
        el.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.dismiss();
          item.action?.();
        });
      }

      this.el.appendChild(el);
    }

    document.body.appendChild(this.el);

    // Position near the click, keeping the menu on-screen.
    const rect = this.el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = x + rect.width > vw ? Math.max(0, vw - rect.width) : x;
    const top = y + rect.height > vh ? Math.max(0, vh - rect.height) : y;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;

    // Prevent the document-level click handler from immediately closing it.
    this.el.addEventListener("mousedown", (e) => e.stopPropagation());

    // Dismiss on outside click.
    this.clickHandler = () => this.dismiss();
    document.addEventListener("mousedown", this.clickHandler);

    // Dismiss on Escape.
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.dismiss();
      }
    };
    document.addEventListener("keydown", this.keydownHandler, { capture: true });
  }

  /** Remove the menu from the DOM and clean up listeners. */
  dismiss(): void {
    if (this.el.parentNode) {
      this.el.remove();
    }
    document.removeEventListener("mousedown", this.clickHandler);
    document.removeEventListener("keydown", this.keydownHandler, {
      capture: true,
    });
  }
}
