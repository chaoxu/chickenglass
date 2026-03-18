/**
 * Application settings: modal dialog + localStorage persistence.
 *
 * Categories: General, Editor, Appearance, Export.
 * Settings take effect immediately when changed.
 */

/** All persisted application settings. */
export interface AppSettings {
  // General
  autoSave: boolean;
  autoSaveInterval: number; // seconds

  // Editor
  fontSize: number; // px
  lineHeight: number; // unitless multiplier
  wordWrap: boolean;
  spellCheck: boolean;

  // Appearance
  theme: "light" | "dark" | "system";
  sidebarWidth: number; // px

  // Export
  defaultExportFormat: "pdf" | "latex";
  exportIncludeLineNumbers: boolean;
}

const STORAGE_KEY = "cg-settings";

const DEFAULT_SETTINGS: AppSettings = {
  autoSave: false,
  autoSaveInterval: 30,
  fontSize: 15,
  lineHeight: 1.6,
  wordWrap: true,
  spellCheck: false,
  theme: "light",
  sidebarWidth: 220,
  defaultExportFormat: "pdf",
  exportIncludeLineNumbers: false,
};

/** Load settings from localStorage, filling in defaults for missing keys. */
export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persist settings to localStorage. */
export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

type SettingsChangeHandler = (settings: AppSettings) => void;

/** Modal preferences dialog with four category tabs. */
export class SettingsDialog {
  /** The root overlay element — append to the DOM to mount the dialog. */
  readonly element: HTMLElement;
  private readonly panel: HTMLElement;
  private current: AppSettings = { ...DEFAULT_SETTINGS };
  private changeHandlers: SettingsChangeHandler[] = [];

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "prefs-overlay";
    this.element.hidden = true;

    this.panel = this.buildPanel();
    this.element.appendChild(this.panel);

    // Click outside the panel to close
    this.element.addEventListener("mousedown", (e) => {
      if (e.target === this.element) this.close();
    });

    // Escape to close — handled on the overlay itself (not document) to avoid leaks
    this.element.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
  }

  /** Register a callback invoked whenever settings change. */
  onChange(handler: SettingsChangeHandler): void {
    this.changeHandlers.push(handler);
  }

  /** Get the current settings snapshot. */
  getSettings(): AppSettings {
    return { ...this.current };
  }

  /** Open the dialog, reloading settings from storage. */
  open(): void {
    this.current = loadSettings();
    this.renderActiveTab();
    this.element.hidden = false;
    this.panel.querySelector<HTMLElement>(".prefs-close")?.focus();
  }

  /** Close the dialog — settings are already saved on each change. */
  close(): void {
    this.element.hidden = true;
  }

  // ── DOM construction ──────────────────────────────────────────────────────

  private buildPanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "prefs-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Preferences");

    // Header
    const header = document.createElement("div");
    header.className = "prefs-header";
    const title = document.createElement("h2");
    title.className = "prefs-title";
    title.textContent = "Preferences";
    const closeBtn = document.createElement("button");
    closeBtn.className = "prefs-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close preferences");
    closeBtn.textContent = "\u2715";
    closeBtn.addEventListener("click", () => this.close());
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Body: sidebar nav + content area
    const body = document.createElement("div");
    body.className = "prefs-body";
    body.appendChild(this.buildNav());
    const content = document.createElement("div");
    content.className = "prefs-content";
    body.appendChild(content);
    panel.appendChild(body);

    return panel;
  }

  private readonly categories = ["General", "Editor", "Appearance", "Export"] as const;
  private activeCategory: (typeof this.categories)[number] = "General";

  private buildNav(): HTMLElement {
    const nav = document.createElement("nav");
    nav.className = "prefs-nav";
    for (const cat of this.categories) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "prefs-nav-item";
      btn.dataset["category"] = cat;
      btn.textContent = cat;
      if (cat === this.activeCategory) btn.classList.add("prefs-nav-item-active");
      btn.addEventListener("click", () => {
        this.activeCategory = cat;
        for (const b of nav.querySelectorAll<HTMLElement>(".prefs-nav-item")) {
          b.classList.toggle("prefs-nav-item-active", b.dataset["category"] === cat);
        }
        this.renderActiveTab();
      });
      nav.appendChild(btn);
    }
    return nav;
  }

  private renderActiveTab(): void {
    const content = this.panel.querySelector<HTMLElement>(".prefs-content");
    if (!content) return;
    content.innerHTML = "";

    switch (this.activeCategory) {
      case "General":
        content.appendChild(this.buildGeneralTab());
        break;
      case "Editor":
        content.appendChild(this.buildEditorTab());
        break;
      case "Appearance":
        content.appendChild(this.buildAppearanceTab());
        break;
      case "Export":
        content.appendChild(this.buildExportTab());
        break;
    }
  }

  // ── Tab builders ──────────────────────────────────────────────────────────

  private buildGeneralTab(): HTMLElement {
    return this.buildTab([
      this.buildToggle("Auto-save", "Save files automatically", this.current.autoSave, (v) =>
        this.update({ autoSave: v }),
      ),
      this.buildNumberInput(
        "Auto-save interval",
        "Seconds between automatic saves",
        this.current.autoSaveInterval,
        5,
        300,
        5,
        (v) => this.update({ autoSaveInterval: v }),
      ),
    ]);
  }

  private buildEditorTab(): HTMLElement {
    return this.buildTab([
      this.buildNumberInput(
        "Font size",
        "Editor font size in pixels",
        this.current.fontSize,
        10,
        32,
        1,
        (v) => this.update({ fontSize: v }),
      ),
      this.buildNumberInput(
        "Line height",
        "Line height multiplier",
        this.current.lineHeight,
        1,
        3,
        0.1,
        (v) => this.update({ lineHeight: v }),
      ),
      this.buildToggle("Word wrap", "Wrap long lines", this.current.wordWrap, (v) =>
        this.update({ wordWrap: v }),
      ),
      this.buildToggle("Spell check", "Underline misspelled words", this.current.spellCheck, (v) =>
        this.update({ spellCheck: v }),
      ),
    ]);
  }

  private buildAppearanceTab(): HTMLElement {
    return this.buildTab([
      this.buildSelect(
        "Theme",
        "Color scheme",
        this.current.theme,
        [
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
          { value: "system", label: "System" },
        ],
        (v) => this.update({ theme: v as AppSettings["theme"] }),
      ),
      this.buildNumberInput(
        "Sidebar width",
        "Sidebar width in pixels",
        this.current.sidebarWidth,
        120,
        480,
        10,
        (v) => this.update({ sidebarWidth: v }),
      ),
    ]);
  }

  private buildExportTab(): HTMLElement {
    return this.buildTab([
      this.buildSelect(
        "Default format",
        "Format used when exporting without specifying one",
        this.current.defaultExportFormat,
        [
          { value: "pdf", label: "PDF" },
          { value: "latex", label: "LaTeX" },
        ],
        (v) => this.update({ defaultExportFormat: v as AppSettings["defaultExportFormat"] }),
      ),
      this.buildToggle(
        "Include line numbers",
        "Add line numbers to exported code blocks",
        this.current.exportIncludeLineNumbers,
        (v) => this.update({ exportIncludeLineNumbers: v }),
      ),
    ]);
  }

  /** Wrap a list of rows in a .prefs-tab container. */
  private buildTab(rows: HTMLElement[]): HTMLElement {
    const tab = document.createElement("div");
    tab.className = "prefs-tab";
    for (const row of rows) tab.appendChild(row);
    return tab;
  }

  // ── Field builders ────────────────────────────────────────────────────────

  /**
   * Build the label+description cell shared by all row types.
   * Returns `{ labelEl, id }` — caller assigns `labelEl.htmlFor = id` and
   * sets the `id` on the control element.
   */
  private buildRowLabel(label: string, description: string): { labelEl: HTMLLabelElement; id: string } {
    const id = `prefs-${label.toLowerCase().replace(/\s+/g, "-")}`;
    const labelEl = document.createElement("label");
    labelEl.className = "prefs-row-label";
    labelEl.htmlFor = id;
    const name = document.createElement("span");
    name.className = "prefs-row-name";
    name.textContent = label;
    const desc = document.createElement("span");
    desc.className = "prefs-row-desc";
    desc.textContent = description;
    labelEl.appendChild(name);
    labelEl.appendChild(desc);
    return { labelEl, id };
  }

  private buildToggle(
    label: string,
    description: string,
    value: boolean,
    onChange: (v: boolean) => void,
  ): HTMLElement {
    const { labelEl, id } = this.buildRowLabel(label, description);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "prefs-toggle";
    input.id = id;
    input.checked = value;
    input.addEventListener("change", () => onChange(input.checked));

    const row = document.createElement("div");
    row.className = "prefs-row";
    row.appendChild(labelEl);
    row.appendChild(input);
    return row;
  }

  private buildNumberInput(
    label: string,
    description: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
  ): HTMLElement {
    const { labelEl, id } = this.buildRowLabel(label, description);
    const input = document.createElement("input");
    input.type = "number";
    input.className = "prefs-number";
    input.id = id;
    input.value = String(value);
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.addEventListener("change", () => {
      const n = parseFloat(input.value);
      if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
    });

    const row = document.createElement("div");
    row.className = "prefs-row";
    row.appendChild(labelEl);
    row.appendChild(input);
    return row;
  }

  private buildSelect(
    label: string,
    description: string,
    value: string,
    options: Array<{ value: string; label: string }>,
    onChange: (v: string) => void,
  ): HTMLElement {
    const { labelEl, id } = this.buildRowLabel(label, description);
    const select = document.createElement("select");
    select.className = "prefs-select";
    select.id = id;
    for (const opt of options) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === value) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener("change", () => onChange(select.value));

    const row = document.createElement("div");
    row.className = "prefs-row";
    row.appendChild(labelEl);
    row.appendChild(select);
    return row;
  }

  // ── State management ──────────────────────────────────────────────────────

  private update(patch: Partial<AppSettings>): void {
    this.current = { ...this.current, ...patch };
    saveSettings(this.current);
    for (const handler of this.changeHandlers) {
      handler(this.current);
    }
  }
}

/**
 * Install the Cmd+, / Ctrl+, keyboard shortcut on a container element.
 * Returns a cleanup function that removes the listener.
 */
export function installPreferencesKeybinding(
  container: HTMLElement,
  dialog: SettingsDialog,
): () => void {
  const handler = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === ",") {
      e.preventDefault();
      dialog.open();
    }
  };
  container.addEventListener("keydown", handler);
  return () => container.removeEventListener("keydown", handler);
}
