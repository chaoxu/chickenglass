/**
 * Command palette component.
 *
 * A floating overlay anchored to the top-center of the editor,
 * accessible via Cmd+P. Provides fuzzy-filtered command search
 * with keyboard navigation (arrow keys, Enter, Escape).
 */

import type { EditorView } from "@codemirror/view";

/** A command that can be executed from the palette. */
export interface PaletteCommand {
  /** Unique command identifier. */
  id: string;
  /** Display label shown in the palette list. */
  label: string;
  /** Optional keyboard shortcut hint (display only). */
  shortcut?: string;
  /** Action to execute when the command is selected. */
  action: (view: EditorView) => void;
}

/**
 * Command palette UI component.
 *
 * Mounts as a fixed overlay with a text input and scrollable
 * results list. Commands are filtered by substring match on the
 * label. Keyboard navigation: ArrowUp/ArrowDown to move selection,
 * Enter to execute, Escape to close.
 */
export class CommandPalette {
  readonly element: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly resultsList: HTMLElement;

  private commands: PaletteCommand[] = [];
  private dynamicProvider: (() => PaletteCommand[]) | null = null;
  private allCommands: PaletteCommand[] = [];
  private filtered: PaletteCommand[] = [];
  private activeIndex = 0;
  private visible = false;
  private view: EditorView | null = null;

  constructor() {
    // Backdrop covers the page behind the palette
    this.backdrop = document.createElement("div");
    this.backdrop.className = "cmd-palette-backdrop";
    this.backdrop.addEventListener("click", () => this.close());

    // Panel container
    this.panel = document.createElement("div");
    this.panel.className = "cmd-palette-panel";

    // Input
    this.input = document.createElement("input");
    this.input.className = "cmd-palette-input";
    this.input.type = "text";
    this.input.placeholder = "Type a command...";
    this.input.addEventListener("input", () => this.onInputChange());
    this.panel.appendChild(this.input);

    // Results list
    this.resultsList = document.createElement("div");
    this.resultsList.className = "cmd-palette-results";
    this.panel.appendChild(this.resultsList);

    // Outer element holds both backdrop and panel
    this.element = document.createElement("div");
    this.element.className = "cmd-palette-overlay";
    this.element.style.display = "none";
    this.element.appendChild(this.backdrop);
    this.element.appendChild(this.panel);

    // Keyboard handling on the panel
    this.panel.addEventListener("keydown", (e) => this.onKeyDown(e));
  }

  /** Register a single command. */
  registerCommand(cmd: PaletteCommand): void {
    // Avoid duplicates
    if (!this.commands.some((c) => c.id === cmd.id)) {
      this.commands.push(cmd);
    }
  }

  /** Register multiple commands at once. */
  registerCommands(cmds: readonly PaletteCommand[]): void {
    for (const cmd of cmds) {
      this.registerCommand(cmd);
    }
  }

  /** Get all registered commands (for testing). */
  getCommands(): readonly PaletteCommand[] {
    return this.commands;
  }

  /** Set a provider for dynamic commands (e.g., heading navigation). */
  setDynamicProvider(provider: () => PaletteCommand[]): void {
    this.dynamicProvider = provider;
  }

  /** Set the editor view for command execution. */
  setView(view: EditorView): void {
    this.view = view;
  }

  /** Open the palette and focus the input. */
  open(): void {
    this.visible = true;
    this.element.style.display = "";
    this.input.value = "";
    this.activeIndex = 0;
    // Rebuild allCommands from static + dynamic
    const dynamic = this.dynamicProvider?.() ?? [];
    this.allCommands = [...this.commands, ...dynamic];
    this.filterAndRender();
    this.input.focus();
  }

  /** Close the palette and return focus to the editor. */
  close(): void {
    this.visible = false;
    this.element.style.display = "none";
    this.view?.focus();
  }

  /** Toggle palette visibility. */
  toggle(): void {
    if (this.visible) {
      this.close();
    } else {
      this.open();
    }
  }

  /** Whether the palette is currently visible. */
  isVisible(): boolean {
    return this.visible;
  }

  /** Get the current query text (for testing). */
  getQuery(): string {
    return this.input.value;
  }

  /** Set the query text programmatically (for testing). */
  setQuery(text: string): void {
    this.input.value = text;
    this.onInputChange();
  }

  /** Get the number of filtered results (for testing). */
  getResultCount(): number {
    return this.filtered.length;
  }

  /** Get the currently highlighted index (for testing). */
  getActiveIndex(): number {
    return this.activeIndex;
  }

  /** Handle input changes: filter commands and re-render. */
  private onInputChange(): void {
    this.activeIndex = 0;
    this.filterAndRender();
  }

  /** Handle keyboard navigation. */
  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (this.filtered.length > 0) {
        this.activeIndex = (this.activeIndex + 1) % this.filtered.length;
        this.updateActiveHighlight();
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (this.filtered.length > 0) {
        this.activeIndex =
          (this.activeIndex - 1 + this.filtered.length) % this.filtered.length;
        this.updateActiveHighlight();
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      this.executeActive();
      return;
    }
  }

  /** Filter commands by substring match on label and render. */
  private filterAndRender(): void {
    const query = this.input.value.toLowerCase().trim();
    this.filtered = query
      ? this.allCommands.filter((cmd) =>
          cmd.label.toLowerCase().includes(query),
        )
      : [...this.allCommands];
    this.renderResults();
  }

  /** Render the filtered results list. */
  private renderResults(): void {
    this.resultsList.innerHTML = "";

    for (let i = 0; i < this.filtered.length; i++) {
      const cmd = this.filtered[i];
      const item = document.createElement("div");
      item.className = "cmd-palette-item";
      if (i === this.activeIndex) {
        item.classList.add("cmd-palette-item-active");
      }
      item.setAttribute("data-index", String(i));

      const label = document.createElement("span");
      label.className = "cmd-palette-item-label";
      label.textContent = cmd.label;
      item.appendChild(label);

      if (cmd.shortcut) {
        const shortcut = document.createElement("span");
        shortcut.className = "cmd-palette-item-shortcut";
        shortcut.textContent = cmd.shortcut;
        item.appendChild(shortcut);
      }

      item.addEventListener("click", () => {
        this.activeIndex = i;
        this.executeActive();
      });

      item.addEventListener("mouseenter", () => {
        this.activeIndex = i;
        this.updateActiveHighlight();
      });

      this.resultsList.appendChild(item);
    }
  }

  /** Update the active highlight without full re-render. */
  private updateActiveHighlight(): void {
    const items = this.resultsList.querySelectorAll(".cmd-palette-item");
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle(
        "cmd-palette-item-active",
        i === this.activeIndex,
      );
    }
    // Scroll active item into view (scrollIntoView may not exist in jsdom)
    const activeItem = items[this.activeIndex] as HTMLElement | undefined;
    if (activeItem && typeof activeItem.scrollIntoView === "function") {
      activeItem.scrollIntoView({ block: "nearest" });
    }
  }

  /** Execute the currently active command. */
  private executeActive(): void {
    const cmd = this.filtered[this.activeIndex];
    if (!cmd || !this.view) return;
    this.close();
    cmd.action(this.view);
  }
}

/**
 * Install a keyboard shortcut to toggle the command palette.
 *
 * Binds Cmd/Ctrl+P to toggle the palette.
 * Returns a cleanup function that removes the listener.
 */
export function installPaletteKeybinding(
  root: HTMLElement,
  palette: CommandPalette,
): () => void {
  const handler = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "p") {
      e.preventDefault();
      palette.toggle();
    }
  };
  root.addEventListener("keydown", handler);
  return () => root.removeEventListener("keydown", handler);
}
