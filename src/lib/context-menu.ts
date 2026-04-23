import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ContextMenu as RadixContextMenu,
  ContextMenuContent as RadixContextMenuContent,
  ContextMenuItem as RadixContextMenuItem,
  ContextMenuSeparator as RadixContextMenuSeparator,
  ContextMenuTrigger as RadixContextMenuTrigger,
} from "../app/components/ui/context-menu";

const CONTEXT_MENU_STYLE_ID = "cf-imperative-context-menu-style";

let activeMenu: ContextMenu | null = null;

function ensureContextMenuStyles(): void {
  if (document.getElementById(CONTEXT_MENU_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = CONTEXT_MENU_STYLE_ID;
  style.textContent = `
    .cf-imperative-context-menu-trigger {
      position: fixed;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
      user-select: none;
    }

    .cf-imperative-context-menu-content {
      z-index: 10050;
      min-width: 10rem;
      overflow: hidden;
      border: 1px solid var(--cf-border);
      border-radius: var(--cf-border-radius-lg, 4px);
      background: var(--cf-bg);
      color: var(--cf-fg);
      padding: 4px;
      box-shadow:
        0 10px 38px rgba(0, 0, 0, 0.14),
        0 10px 20px rgba(0, 0, 0, 0.08);
      font-family: var(--cf-ui-font, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--cf-ui-font-size-base, 14px);
    }

    .cf-imperative-context-menu-item {
      position: relative;
      display: flex;
      align-items: center;
      border-radius: var(--cf-border-radius, 2px);
      padding: 6px 8px;
      outline: none;
      user-select: none;
    }

    .cf-imperative-context-menu-item[data-highlighted] {
      background: var(--cf-hover);
    }

    .cf-imperative-context-menu-item[data-disabled] {
      opacity: 0.5;
      pointer-events: none;
    }

    .cf-imperative-context-menu-separator {
      height: 1px;
      margin: 4px 0;
      background: var(--cf-border);
    }
  `;

  (document.head ?? document.body).appendChild(style);
}

/** A single item in a context menu. */
export interface ContextMenuItem {
  /** Display label. Use "-" for a separator. */
  label: string;
  /** Action to invoke when the item is clicked. */
  action?: () => void;
  /** Whether the item is disabled. */
  disabled?: boolean;
}

interface ContextMenuViewProps {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onDismiss: () => void;
  setTriggerEl: (node: HTMLSpanElement | null) => void;
}

function ContextMenuView({
  items,
  x,
  y,
  onDismiss,
  setTriggerEl,
}: ContextMenuViewProps) {
  return createElement(
    RadixContextMenu,
    {
      onOpenChange: (open: boolean) => {
        if (!open) {
          queueMicrotask(onDismiss);
        }
      },
    },
    createElement(RadixContextMenuTrigger, {
      ref: setTriggerEl,
      className: "cf-imperative-context-menu-trigger",
      style: { left: x, top: y },
    }),
    createElement(
      RadixContextMenuContent,
      {
        className: "cf-imperative-context-menu-content",
        collisionPadding: 8,
        onCloseAutoFocus: (event: Event) => {
          event.preventDefault();
        },
      },
      items.map((item, index) => (
        item.label === "-"
          ? createElement(RadixContextMenuSeparator, {
              key: `separator-${index}`,
              className: "cf-imperative-context-menu-separator",
            })
          : createElement(
              RadixContextMenuItem,
              {
                key: `item-${index}-${item.label}`,
                className: "cf-imperative-context-menu-item",
                disabled: item.disabled,
                onSelect: () => {
                  item.action?.();
                },
              },
              item.label,
            )
      )),
    ),
  );
}

/**
 * Imperative context menu wrapper used by non-React editor and app code.
 *
 * The public API stays the same for existing callers, but the rendering and
 * dismissal behavior are delegated to Radix for accessibility and focus
 * management.
 */
export class ContextMenu {
  private readonly host: HTMLElement;
  private readonly root: Root;
  private triggerEl: HTMLSpanElement | null = null;
  private dismissed = false;

  /**
   * Create and show a context menu.
   *
   * @param items - Menu items to display.
   * @param x - Client X coordinate near which to position the menu.
   * @param y - Client Y coordinate near which to position the menu.
   */
  constructor(items: ContextMenuItem[], x: number, y: number) {
    activeMenu?.dismiss();
    activeMenu = this;

    ensureContextMenuStyles();

    this.host = document.createElement("div");
    document.body.appendChild(this.host);
    this.root = createRoot(this.host);

    this.root.render(
      createElement(ContextMenuView, {
        items,
        x,
        y,
        onDismiss: () => this.dismiss(),
        setTriggerEl: (node) => {
          this.triggerEl = node;
          if (!node) {
            return;
          }
          queueMicrotask(() => {
            if (this.dismissed || this.triggerEl !== node) {
              return;
            }
            node.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                button: 2,
                buttons: 2,
                clientX: x,
                clientY: y,
              }),
            );
          });
        },
      }),
    );
  }

  /** Remove the menu from the DOM and clean up its mounted React root. */
  dismiss(): void {
    if (this.dismissed) {
      return;
    }

    this.dismissed = true;
    if (activeMenu === this) {
      activeMenu = null;
    }

    this.root.unmount();
    this.host.remove();
    this.triggerEl = null;
  }
}
