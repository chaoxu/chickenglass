/**
 * Document outline panel.
 *
 * Displays a table of contents derived from the document's ATX headings.
 * Each entry shows the section number and heading text. Clicking an
 * entry scrolls the editor to that heading.
 */

import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

/** A single outline entry. */
interface OutlineEntry {
  /** Heading level (1–6). */
  level: number;
  /** Heading text (without # markers). */
  text: string;
  /** Hierarchical section number (e.g., "1.2.3"). */
  number: string;
  /** Document position of the heading. */
  pos: number;
}

/** Extract outline entries from the editor state. */
function extractOutline(view: EditorView): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const counters = [0, 0, 0, 0, 0, 0, 0];
  const tree = syntaxTree(view.state);

  tree.iterate({
    enter(node) {
      const m = /^ATXHeading(\d)$/.exec(node.name);
      if (!m) return;

      const level = Number(m[1]);
      counters[level]++;
      for (let i = level + 1; i <= 6; i++) counters[i] = 0;

      const parts: number[] = [];
      for (let i = 1; i <= level; i++) parts.push(counters[i]);

      // Extract text: skip HeaderMark children, get remaining text
      const lineText = view.state.doc.lineAt(node.from).text;
      const text = lineText.replace(/^#+\s*/, "");

      entries.push({
        level,
        text,
        number: parts.join("."),
        pos: node.from,
      });
    },
  });

  return entries;
}

/** Document outline component for the sidebar. */
export class Outline {
  readonly element: HTMLElement;
  private view: EditorView | null = null;
  private cleanup: (() => void) | null = null;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "outline-list";
  }

  /** Attach to an editor view and start tracking changes. */
  attach(view: EditorView): void {
    this.detach();
    this.view = view;
    this.refresh();

    // Periodically refresh outline to track doc changes
    const interval = setInterval(() => this.refresh(), 1000);
    this.cleanup = () => clearInterval(interval);
  }

  /** Detach from the current editor view. */
  detach(): void {
    this.cleanup?.();
    this.cleanup = null;
    this.view = null;
    this.element.innerHTML = "";
  }

  /** Rebuild the outline from the current editor state. */
  private refresh(): void {
    if (!this.view) return;

    const entries = extractOutline(this.view);
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
