/**
 * Keyboard shortcuts reference dialog.
 *
 * Displays a searchable list of all keyboard shortcuts organized by category.
 * Opens with Cmd+/ (or Ctrl+/), closes with Escape or clicking the backdrop.
 */

/** A single keyboard shortcut entry. */
export interface ShortcutItem {
  /** Human-readable description of what the shortcut does. */
  label: string;
  /** Key combination to display (e.g. "Cmd+S", "Ctrl+Shift+F"). */
  keys: string;
}

/** A category grouping related shortcuts. */
export interface ShortcutCategory {
  /** Category heading. */
  name: string;
  /** Shortcuts in this category. */
  items: ShortcutItem[];
}

/** All shortcut categories and their items. */
const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    name: "File",
    items: [
      { label: "Save file", keys: "Cmd+S" },
      { label: "Export to PDF", keys: "Cmd+Shift+E" },
      { label: "Export to LaTeX", keys: "Cmd+Shift+L" },
    ],
  },
  {
    name: "Edit",
    items: [
      { label: "Undo", keys: "Cmd+Z" },
      { label: "Redo", keys: "Cmd+Shift+Z" },
      { label: "Bold", keys: "Cmd+B" },
      { label: "Italic", keys: "Cmd+I" },
      { label: "Inline code", keys: "Cmd+Shift+K" },
      { label: "Link", keys: "Cmd+K" },
      { label: "Strikethrough", keys: "Cmd+Shift+X" },
      { label: "Highlight", keys: "Cmd+Shift+H" },
    ],
  },
  {
    name: "View",
    items: [
      { label: "Cycle editor mode (Rendered / Source / Preview)", keys: "Cmd+Shift+M" },
      { label: "Toggle focus mode", keys: "Cmd+Shift+F" },
      { label: "Toggle debug inspector", keys: "Cmd+Shift+D" },
    ],
  },
  {
    name: "Navigation",
    items: [
      { label: "Command palette", keys: "Cmd+P" },
      { label: "Semantic search", keys: "Cmd+Shift+F" },
      { label: "Keyboard shortcuts reference", keys: "Cmd+/" },
      { label: "Jump to source file (includes)", keys: "Cmd+Shift+O" },
    ],
  },
  {
    name: "Format",
    items: [
      { label: "Insert inline math ($...$)", keys: "via Command Palette" },
      { label: "Insert display math ($$...$$)", keys: "via Command Palette" },
      { label: "Insert Theorem block", keys: "via Command Palette" },
      { label: "Insert Lemma block", keys: "via Command Palette" },
      { label: "Insert Proof block", keys: "via Command Palette" },
      { label: "Insert Definition block", keys: "via Command Palette" },
    ],
  },
];

/**
 * Keyboard shortcuts reference dialog component.
 *
 * Mounts as a fixed overlay with a search input and a grid of shortcut
 * categories. Pressing Cmd+/ or Ctrl+/ opens the dialog; Escape or
 * clicking the backdrop closes it.
 */
export class ShortcutsDialog {
  readonly element: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly searchInput: HTMLInputElement;
  private readonly body: HTMLElement;

  private visible = false;

  constructor() {
    // Backdrop
    this.backdrop = document.createElement("div");
    this.backdrop.className = "shortcuts-backdrop";
    this.backdrop.addEventListener("click", () => this.close());

    // Panel
    this.panel = document.createElement("div");
    this.panel.className = "shortcuts-panel";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-modal", "true");
    this.panel.setAttribute("aria-label", "Keyboard Shortcuts");

    // Header
    const header = document.createElement("div");
    header.className = "shortcuts-header";

    const title = document.createElement("h2");
    title.className = "shortcuts-title";
    title.textContent = "Keyboard Shortcuts";
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.className = "shortcuts-close-btn";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "\u00d7"; // ×
    closeBtn.addEventListener("click", () => this.close());
    header.appendChild(closeBtn);

    this.panel.appendChild(header);

    // Search input
    this.searchInput = document.createElement("input");
    this.searchInput.className = "shortcuts-search";
    this.searchInput.type = "search";
    this.searchInput.placeholder = "Filter shortcuts\u2026";
    this.searchInput.setAttribute("aria-label", "Filter shortcuts");
    this.searchInput.addEventListener("input", () => this.render());
    this.panel.appendChild(this.searchInput);

    // Scrollable body
    this.body = document.createElement("div");
    this.body.className = "shortcuts-body";
    this.panel.appendChild(this.body);

    // Footer hint
    const footer = document.createElement("div");
    footer.className = "shortcuts-footer";
    footer.textContent = "Press Escape to close";
    this.panel.appendChild(footer);

    // Outer overlay
    this.element = document.createElement("div");
    this.element.className = "shortcuts-overlay";
    this.element.style.display = "none";
    this.element.appendChild(this.backdrop);
    this.element.appendChild(this.panel);

    this.panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });
  }

  /** Open the dialog and focus the search input. */
  open(): void {
    this.visible = true;
    this.element.style.display = "";
    this.searchInput.value = "";
    this.render();
    this.searchInput.focus();
  }

  /** Close the dialog. */
  close(): void {
    this.visible = false;
    this.element.style.display = "none";
  }

  /** Toggle visibility. */
  toggle(): void {
    if (this.visible) {
      this.close();
    } else {
      this.open();
    }
  }

  /** Whether the dialog is currently visible. */
  isVisible(): boolean {
    return this.visible;
  }

  /** Render (or re-render) the shortcuts grid, filtered by search query. */
  private render(): void {
    const query = this.searchInput.value.toLowerCase().trim();
    this.body.innerHTML = "";

    let anyVisible = false;

    for (const category of SHORTCUT_CATEGORIES) {
      const filteredItems = query
        ? category.items.filter(
            (item) =>
              item.label.toLowerCase().includes(query) ||
              item.keys.toLowerCase().includes(query),
          )
        : category.items;

      if (filteredItems.length === 0) continue;
      anyVisible = true;

      const section = document.createElement("section");
      section.className = "shortcuts-section";

      const heading = document.createElement("h3");
      heading.className = "shortcuts-category";
      heading.textContent = category.name;
      section.appendChild(heading);

      const grid = document.createElement("dl");
      grid.className = "shortcuts-grid";

      for (const item of filteredItems) {
        const dt = document.createElement("dt");
        dt.className = "shortcuts-label";
        dt.textContent = item.label;
        grid.appendChild(dt);

        const dd = document.createElement("dd");
        dd.className = "shortcuts-keys";
        // Render each key combo part as a <kbd> element
        const parts = item.keys.split("+");
        for (const [i, part] of parts.entries()) {
          if (i > 0) {
            dd.appendChild(document.createTextNode("+"));
          }
          const kbd = document.createElement("kbd");
          kbd.textContent = part;
          dd.appendChild(kbd);
        }
        grid.appendChild(dd);
      }

      section.appendChild(grid);
      this.body.appendChild(section);
    }

    if (!anyVisible) {
      const empty = document.createElement("p");
      empty.className = "shortcuts-empty";
      empty.textContent = "No shortcuts match your search.";
      this.body.appendChild(empty);
    }
  }
}

/**
 * Install the Cmd+/ (or Ctrl+/) keyboard shortcut to toggle the dialog.
 * Returns a cleanup function that removes the listener.
 */
export function installShortcutsKeybinding(
  root: HTMLElement,
  dialog: ShortcutsDialog,
): () => void {
  const handler = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === "/") {
      e.preventDefault();
      dialog.toggle();
    }
  };
  root.addEventListener("keydown", handler);
  return () => root.removeEventListener("keydown", handler);
}
