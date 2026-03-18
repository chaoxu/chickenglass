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

/** Tab bar component showing open files. */
export class TabBar {
  readonly element: HTMLElement;
  private tabs: Tab[] = [];
  private activeTab: string | null = null;
  private onSelect: TabSelectHandler | null = null;
  private onClose: TabCloseHandler | null = null;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "tab-bar";
  }

  /** Set the handler called when a tab is clicked. */
  setSelectHandler(handler: TabSelectHandler): void {
    this.onSelect = handler;
  }

  /** Set the handler called when a tab close button is clicked. */
  setCloseHandler(handler: TabCloseHandler): void {
    this.onClose = handler;
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

  private renderTabs(): void {
    this.element.innerHTML = "";

    for (const tab of this.tabs) {
      const tabEl = document.createElement("div");
      tabEl.className = "tab";
      if (tab.path === this.activeTab) {
        tabEl.classList.add("tab-active");
      }

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
