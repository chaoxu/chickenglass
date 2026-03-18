/** Represents a single open file tab. */
export interface Tab {
  /** File path used as the unique identifier. */
  path: string;
  /** Display name (file name without directory). */
  name: string;
  /** Whether the file has unsaved changes. */
  dirty: boolean;
}

/** Callback when a tab is selected. */
export type TabSelectHandler = (path: string) => void;

/** Callback when a tab's close button is clicked. */
export type TabCloseHandler = (path: string) => void;

/** Callback when tab order changes due to drag-and-drop reordering. */
export type TabReorderHandler = (orderedPaths: string[]) => void;

/** Tab bar component showing open files with drag-and-drop reordering. */
export class TabBar {
  readonly element: HTMLElement;
  private tabs: Tab[] = [];
  private activeTab: string | null = null;
  private onSelect: TabSelectHandler | null = null;
  private onClose: TabCloseHandler | null = null;
  private onReorder: TabReorderHandler | null = null;

  /** Path of the tab currently being dragged, or null. */
  private dragSrcPath: string | null = null;
  /** The drop-indicator line element shown during drag. */
  private readonly dropIndicator: HTMLElement;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "tab-bar";

    this.dropIndicator = document.createElement("div");
    this.dropIndicator.className = "tab-drop-indicator";
    this.dropIndicator.style.display = "none";
    this.element.appendChild(this.dropIndicator);

    // Container-level drag events are registered once in the constructor so
    // they don't accumulate across re-renders.
    this.element.addEventListener("dragover", (e) => {
      if (!this.dragSrcPath) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const tabEls = this.getTabElements();
      const dropIndex = this.dropIndexFromX(e.clientX, tabEls);
      this.showDropIndicator(dropIndex, tabEls);
    });

    this.element.addEventListener("dragleave", (e) => {
      // Only hide when the pointer leaves the bar entirely.
      if (!this.element.contains(e.relatedTarget as Node)) {
        this.hideDropIndicator();
      }
    });

    this.element.addEventListener("drop", (e) => {
      e.preventDefault();
      const srcPath = this.dragSrcPath;
      this.dragSrcPath = null;
      this.hideDropIndicator();

      if (!srcPath) return;

      const tabEls = this.getTabElements();
      const dropIndex = this.dropIndexFromX(e.clientX, tabEls);
      const srcIndex = this.tabs.findIndex((t) => t.path === srcPath);
      if (srcIndex === -1) return;

      // Remove the dragged tab then insert at the computed position.
      // If the source was before the drop point, adjust by -1 because the
      // array shrank by one.
      const srcTab = this.tabs.splice(srcIndex, 1)[0];
      const insertAt = srcIndex < dropIndex ? dropIndex - 1 : dropIndex;
      this.tabs.splice(insertAt, 0, srcTab);

      this.renderTabs();
      this.onReorder?.(this.tabs.map((t) => t.path));
    });
  }

  /** Set the handler called when a tab is clicked. */
  setSelectHandler(handler: TabSelectHandler): void {
    this.onSelect = handler;
  }

  /** Set the handler called when a tab close button is clicked. */
  setCloseHandler(handler: TabCloseHandler): void {
    this.onClose = handler;
  }

  /** Set the handler called when tabs are reordered by drag-and-drop. */
  setReorderHandler(handler: TabReorderHandler): void {
    this.onReorder = handler;
  }

  /** Open a new tab or activate an existing one. */
  openTab(path: string, name: string): void {
    const existing = this.tabs.find((t) => t.path === path);
    if (!existing) {
      this.tabs.push({ path, name, dirty: false });
    }
    this.activeTab = path;
    this.renderTabs();
  }

  /** Close a tab by path. Returns the next tab to activate, or null. */
  closeTab(path: string): string | null {
    const index = this.tabs.findIndex((t) => t.path === path);
    if (index === -1) return this.activeTab;

    this.tabs.splice(index, 1);

    if (this.activeTab === path) {
      if (this.tabs.length === 0) {
        this.activeTab = null;
      } else {
        const newIndex = Math.min(index, this.tabs.length - 1);
        this.activeTab = this.tabs[newIndex].path;
      }
    }

    this.renderTabs();
    return this.activeTab;
  }

  /** Set the active tab by path. */
  setActiveTab(path: string): void {
    this.activeTab = path;
    this.renderTabs();
  }

  /** Update the display name of a tab (e.g. from frontmatter title). */
  updateName(path: string, name: string): void {
    const tab = this.tabs.find((t) => t.path === path);
    if (tab && tab.name !== name) {
      tab.name = name;
      this.renderTabs();
    }
  }

  /**
   * Rename a tab: update its path and display name.
   * Also updates the active tab pointer if the renamed tab was active.
   */
  renameTab(oldPath: string, newPath: string, newName: string): void {
    const tab = this.tabs.find((t) => t.path === oldPath);
    if (!tab) return;
    tab.path = newPath;
    tab.name = newName;
    if (this.activeTab === oldPath) {
      this.activeTab = newPath;
    }
    this.renderTabs();
  }

  /** Mark a tab as dirty (unsaved changes). */
  setDirty(path: string, dirty: boolean): void {
    const tab = this.tabs.find((t) => t.path === path);
    if (tab && tab.dirty !== dirty) {
      tab.dirty = dirty;
      this.renderTabs();
    }
  }

  /** Check whether a tab is currently open. */
  hasTab(path: string): boolean {
    return this.tabs.some((t) => t.path === path);
  }

  /** Get the active tab path. */
  getActiveTab(): string | null {
    return this.activeTab;
  }

  /** Get all open tab paths. */
  getOpenTabs(): readonly Tab[] {
    return this.tabs;
  }

  /** Return the current live tab elements in DOM order. */
  private getTabElements(): HTMLElement[] {
    return Array.from(this.element.querySelectorAll<HTMLElement>(".tab"));
  }

  /**
   * Calculate the insertion index for a drop at the given mouse X coordinate.
   * Compares against the midpoint of each tab to decide whether to insert
   * before or after it.
   */
  private dropIndexFromX(clientX: number, tabEls: HTMLElement[]): number {
    for (let i = 0; i < tabEls.length; i++) {
      const rect = tabEls[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) {
        return i;
      }
    }
    return tabEls.length;
  }

  /**
   * Position and show the drop indicator before the tab at dropIndex.
   * If dropIndex equals the tab count, the indicator is placed after the
   * last tab.
   */
  private showDropIndicator(dropIndex: number, tabEls: HTMLElement[]): void {
    const barRect = this.element.getBoundingClientRect();

    let indicatorX: number;
    if (dropIndex < tabEls.length) {
      indicatorX = tabEls[dropIndex].getBoundingClientRect().left - barRect.left;
    } else if (tabEls.length > 0) {
      indicatorX = tabEls[tabEls.length - 1].getBoundingClientRect().right - barRect.left;
    } else {
      indicatorX = 0;
    }

    this.dropIndicator.style.left = `${indicatorX}px`;
    this.dropIndicator.style.display = "block";
  }

  private hideDropIndicator(): void {
    this.dropIndicator.style.display = "none";
  }

  private renderTabs(): void {
    // Reset to just the persistent drop indicator, matching the codebase's
    // innerHTML = "" convention but preserving the indicator element.
    this.element.innerHTML = "";
    this.element.appendChild(this.dropIndicator);

    for (const tab of this.tabs) {
      const tabEl = document.createElement("div");
      tabEl.className = "tab";
      if (tab.path === this.activeTab) {
        tabEl.classList.add("tab-active");
      }

      // HTML5 drag-and-drop attributes and per-tab listeners.
      tabEl.draggable = true;

      tabEl.addEventListener("dragstart", (e) => {
        this.dragSrcPath = tab.path;
        tabEl.classList.add("tab-dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", tab.path);
        }
      });

      tabEl.addEventListener("dragend", () => {
        this.dragSrcPath = null;
        tabEl.classList.remove("tab-dragging");
        this.hideDropIndicator();
      });

      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = tab.name;
      tabEl.appendChild(label);

      if (tab.dirty) {
        const indicator = document.createElement("span");
        indicator.className = "tab-dirty";
        indicator.textContent = "\u2022";
        tabEl.appendChild(indicator);
      }

      const closeBtn = document.createElement("span");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "\u00D7";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onClose?.(tab.path);
      });
      tabEl.appendChild(closeBtn);

      tabEl.addEventListener("click", () => {
        this.onSelect?.(tab.path);
      });

      this.element.appendChild(tabEl);
    }
  }
}
