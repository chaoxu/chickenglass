/**
 * Writing Statistics popup.
 *
 * Displays a detailed stats panel anchored near the word-count button in the
 * status bar. Shown on click, dismissed by clicking outside or pressing Escape.
 *
 * Stats shown:
 * - Word count
 * - Character count (with and without spaces)
 * - Sentence count
 * - Estimated reading time (words / 200 wpm)
 * - Session stats (words typed since tracking began this session)
 */

/** Computed document statistics. */
export interface DocStats {
  words: number;
  chars: number;
  charsNoSpaces: number;
  sentences: number;
  /** Estimated reading time in minutes (rounded up, minimum 1). */
  readingMinutes: number;
}

/**
 * Format a readingMinutes value as a human-readable string.
 * 0 → "< 1 min", 1 → "1 min", N → "N min"
 */
export function formatReadingTime(minutes: number): string {
  if (minutes === 0) return "< 1 min";
  if (minutes === 1) return "1 min";
  return `${minutes} min`;
}

/** Compute document statistics from raw markdown text. */
export function computeDocStats(text: string): DocStats {
  // Strip YAML frontmatter
  const body = text.replace(/^---[\s\S]*?---\n?/, "");

  // Word count
  const wordTokens = body.split(/\s+/).filter((t) => t.length > 0);
  const words = wordTokens.length;

  // Character counts
  const chars = body.length;
  const charsNoSpaces = body.replace(/\s/g, "").length;

  // Sentence count: split on sentence-ending punctuation followed by
  // whitespace or end-of-string. Minimum 1 sentence if text is non-empty.
  const sentenceMatches = body.match(/[.!?]+(?:\s|$)/g);
  const sentences = words === 0 ? 0 : Math.max(1, sentenceMatches?.length ?? 1);

  // Reading time at 200 words per minute, minimum 1 min when there are words
  const readingMinutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / 200));

  return { words, chars, charsNoSpaces, sentences, readingMinutes };
}

/**
 * Writing statistics popup panel.
 *
 * Lifecycle:
 * 1. Construct once, append `.element` to the document root.
 * 2. Call `update(stats)` each time the document changes (pass the result of
 *    `computeDocStats` — the caller already has it for the word-count badge).
 * 3. Call `open(anchorEl)` to show the popup anchored above `anchorEl`.
 * 4. The popup dismisses itself on backdrop click or Escape.
 */
export class WritingStatsPopup {
  readonly element: HTMLElement;

  private readonly backdrop: HTMLElement;
  private readonly panel: HTMLElement;

  // Stat display elements
  private readonly wordCountEl: HTMLElement;
  private readonly charCountEl: HTMLElement;
  private readonly charNoSpaceEl: HTMLElement;
  private readonly sentenceCountEl: HTMLElement;
  private readonly readingTimeEl: HTMLElement;

  // Session tracking
  private readonly sessionSection: HTMLElement;
  private readonly sessionWordsEl: HTMLElement;
  private readonly sessionTimeEl: HTMLElement;
  private readonly trackBtn: HTMLButtonElement;

  private visible = false;
  private currentStats: DocStats = {
    words: 0,
    chars: 0,
    charsNoSpaces: 0,
    sentences: 0,
    readingMinutes: 0,
  };

  /** Words at session start (set when session tracking begins). */
  private sessionStartWords: number | null = null;
  /** Timestamp when session tracking began. */
  private sessionStartTime: number | null = null;

  constructor() {
    // Backdrop: transparent overlay that dismisses on click
    this.backdrop = document.createElement("div");
    this.backdrop.className = "writing-stats-backdrop";
    this.backdrop.addEventListener("click", () => this.close());

    // Panel
    this.panel = document.createElement("div");
    this.panel.className = "writing-stats-panel";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", "Writing statistics");
    // Set once so open() doesn't repeat the setAttribute call
    this.panel.setAttribute("tabindex", "-1");

    // Title row
    const titleRow = document.createElement("div");
    titleRow.className = "writing-stats-title";
    titleRow.textContent = "Writing Statistics";
    this.panel.appendChild(titleRow);

    // Stats grid
    const grid = document.createElement("div");
    grid.className = "writing-stats-grid";

    this.wordCountEl = this.addRow(grid, "Words");
    this.charCountEl = this.addRow(grid, "Characters");
    this.charNoSpaceEl = this.addRow(grid, "Without spaces");
    this.sentenceCountEl = this.addRow(grid, "Sentences");
    this.readingTimeEl = this.addRow(grid, "Reading time");

    this.panel.appendChild(grid);

    // Session section — hidden until tracking starts; CSS hides by default
    this.sessionSection = document.createElement("div");
    this.sessionSection.className = "writing-stats-session writing-stats-session-hidden";

    const sessionTitle = document.createElement("div");
    sessionTitle.className = "writing-stats-session-title";
    sessionTitle.textContent = "This Session";
    this.sessionSection.appendChild(sessionTitle);

    const sessionGrid = document.createElement("div");
    sessionGrid.className = "writing-stats-grid";
    this.sessionWordsEl = this.addRow(sessionGrid, "Words added");
    this.sessionTimeEl = this.addRow(sessionGrid, "Time");
    this.sessionSection.appendChild(sessionGrid);

    this.panel.appendChild(this.sessionSection);

    // Track session button — ref stored so renderSession can update label
    this.trackBtn = document.createElement("button");
    this.trackBtn.className = "writing-stats-track-btn";
    this.trackBtn.textContent = "Start Session";
    this.trackBtn.type = "button";
    this.trackBtn.addEventListener("click", () => this.toggleSession());
    this.panel.appendChild(this.trackBtn);

    // Outer wrapper
    this.element = document.createElement("div");
    this.element.className = "writing-stats-overlay";
    this.element.style.display = "none";
    this.element.appendChild(this.backdrop);
    this.element.appendChild(this.panel);

    // Dismiss on Escape
    this.element.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });

    this.renderStats();
  }

  /**
   * Update the internal stats cache and refresh the display if visible.
   * Accepts a pre-computed DocStats object so the caller can reuse the value
   * that was already computed for the status-bar word-count badge.
   */
  update(stats: DocStats): void {
    this.currentStats = stats;
    if (this.visible) {
      this.renderStats();
      this.renderSession();
    }
  }

  /**
   * Open the popup, positioning it above the anchor element.
   * Refreshes the display before showing.
   */
  open(anchor: HTMLElement): void {
    this.visible = true;
    this.element.style.display = "";
    this.renderStats();
    this.renderSession();
    this.positionNear(anchor);
    this.panel.focus();
  }

  /** Close the popup. */
  close(): void {
    this.visible = false;
    this.element.style.display = "none";
  }

  /** Toggle visibility. */
  toggle(anchor: HTMLElement): void {
    if (this.visible) {
      this.close();
    } else {
      this.open(anchor);
    }
  }

  /** Whether the popup is currently shown. */
  isVisible(): boolean {
    return this.visible;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private addRow(parent: HTMLElement, label: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "writing-stats-row";

    const labelEl = document.createElement("span");
    labelEl.className = "writing-stats-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("span");
    valueEl.className = "writing-stats-value";
    valueEl.textContent = "—";

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    parent.appendChild(row);

    return valueEl;
  }

  private renderStats(): void {
    const s = this.currentStats;
    this.wordCountEl.textContent = s.words.toLocaleString();
    this.charCountEl.textContent = s.chars.toLocaleString();
    this.charNoSpaceEl.textContent = s.charsNoSpaces.toLocaleString();
    this.sentenceCountEl.textContent = s.sentences.toLocaleString();
    this.readingTimeEl.textContent = formatReadingTime(s.readingMinutes);
  }

  private renderSession(): void {
    if (this.sessionStartWords === null || this.sessionStartTime === null) {
      this.sessionSection.classList.add("writing-stats-session-hidden");
      this.trackBtn.textContent = "Start Session";
      return;
    }

    this.sessionSection.classList.remove("writing-stats-session-hidden");
    this.trackBtn.textContent = "Reset Session";

    const added = Math.max(
      0,
      this.currentStats.words - this.sessionStartWords,
    );
    this.sessionWordsEl.textContent = `+${added.toLocaleString()}`;

    const elapsedMs = Date.now() - this.sessionStartTime;
    const elapsedMin = Math.floor(elapsedMs / 60_000);
    const elapsedSec = Math.floor((elapsedMs % 60_000) / 1_000);
    this.sessionTimeEl.textContent =
      elapsedMin > 0
        ? `${elapsedMin}m ${elapsedSec}s`
        : `${elapsedSec}s`;
  }

  private toggleSession(): void {
    if (this.sessionStartWords === null) {
      this.sessionStartWords = this.currentStats.words;
      this.sessionStartTime = Date.now();
    } else {
      this.sessionStartWords = null;
      this.sessionStartTime = null;
    }
    this.renderSession();
  }

  private positionNear(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    // Position the panel above the anchor, aligned to its left edge
    this.panel.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    this.panel.style.left = `${rect.left}px`;
  }
}
