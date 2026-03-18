/**
 * Document outline panel.
 *
 * Displays a table of contents derived from the document's ATX headings.
 * Each entry shows the section number and heading text. Clicking an
 * entry scrolls the editor to that heading. The active section is
 * highlighted based on the cursor position.
 */

import { EditorView } from "@codemirror/view";
import { StateEffect } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { extractHeadings, activeHeadingIndex } from "./heading-ancestry";

/** Document outline component for the sidebar. */
export class Outline {
  readonly element: HTMLElement;
  private view: EditorView | null = null;
  private lastTreeLength = 0;
  private lastActiveIndex = -1;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "outline-list";
  }

  /** Attach to an editor view and start tracking changes. */
  attach(view: EditorView): void {
    this.detach();
    this.view = view;
    this.lastTreeLength = 0;
    this.lastActiveIndex = -1;
    this.refresh();

    const extension = EditorView.updateListener.of((update) => {
      if (!this.view) return;
      const tree = syntaxTree(update.state);
      const treeAdvanced = tree.length > this.lastTreeLength;
      if (update.docChanged || treeAdvanced) {
        this.lastTreeLength = tree.length;
        this.refresh();
      }
      // Update active heading highlight on cursor move
      if (update.selectionSet || update.docChanged || treeAdvanced) {
        this.updateActiveHeading();
      }
    });

    view.dispatch({ effects: StateEffect.appendConfig.of(extension) });
  }

  /** Detach from the current editor view. */
  detach(): void {
    this.view = null;
    this.lastActiveIndex = -1;
    this.element.innerHTML = "";
  }

  /** Rebuild the outline from the current editor state. */
  private refresh(): void {
    if (!this.view) return;

    const entries = extractHeadings(this.view.state);
    const view = this.view;

    // Only rebuild DOM if content changed
    const key = entries.map((e) => `${e.number}:${e.text}:${e.pos}`).join("\n");
    if (this.element.getAttribute("data-key") === key) return;
    this.element.setAttribute("data-key", key);

    this.element.innerHTML = "";

    // Build a flat list with collapse toggles for entries that have children
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const hasChildren =
        i + 1 < entries.length && entries[i + 1].level > entry.level;

      const item = document.createElement("div");
      item.className = "outline-item";
      item.style.paddingLeft = `${(entry.level - 1) * 12 + 8}px`;
      item.setAttribute("data-level", String(entry.level));
      item.setAttribute("data-index", String(i));

      if (hasChildren) {
        const toggle = document.createElement("span");
        toggle.className = "outline-toggle";
        toggle.textContent = "▼";
        toggle.addEventListener("click", (e) => {
          e.stopPropagation();
          const collapsed = toggle.textContent === "▶";
          toggle.textContent = collapsed ? "▼" : "▶";
          this.toggleChildren(item, entry.level, !collapsed);
        });
        item.appendChild(toggle);
      } else {
        const spacer = document.createElement("span");
        spacer.className = "outline-toggle outline-toggle-spacer";
        item.appendChild(spacer);
      }

      const num = document.createElement("span");
      num.className = "outline-number";
      num.textContent = entry.number;

      const text = document.createElement("span");
      text.className = "outline-text";
      text.textContent = entry.text;

      item.appendChild(num);
      item.appendChild(text);

      const pos = entry.pos;
      item.addEventListener("click", () => {
        view.dispatch({
          selection: { anchor: pos },
          scrollIntoView: true,
        });
        view.focus();
      });

      this.element.appendChild(item);
    }
  }

  /** Update the active heading highlight in the outline. */
  private updateActiveHeading(): void {
    if (!this.view) return;

    const headings = extractHeadings(this.view.state);
    const cursorPos = this.view.state.selection.main.head;
    const idx = activeHeadingIndex(headings, cursorPos);

    if (idx === this.lastActiveIndex) return;
    this.lastActiveIndex = idx;

    const items = this.element.querySelectorAll(".outline-item");
    items.forEach((item, i) => {
      item.classList.toggle("outline-item-active", i === idx);
    });
  }

  /** Toggle visibility of children after the given item. */
  private toggleChildren(
    parentItem: HTMLElement,
    parentLevel: number,
    hide: boolean,
  ): void {
    let sibling = parentItem.nextElementSibling as HTMLElement | null;
    while (sibling) {
      const level = Number(sibling.getAttribute("data-level") ?? "0");
      if (level <= parentLevel) break; // reached same or higher level
      sibling.style.display = hide ? "none" : "";
      sibling = sibling.nextElementSibling as HTMLElement | null;
    }
  }
}
