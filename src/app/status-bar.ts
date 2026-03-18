import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { EditorMode } from "../editor";
import { computeDocStats, WritingStatsPopup } from "./writing-stats";

/** Callback invoked when the user clicks the mode indicator to cycle modes. */
export type ModeChangeHandler = (mode: EditorMode) => void;

const MODE_ORDER: EditorMode[] = ["rendered", "source", "preview"];
const MODE_LABELS: Record<EditorMode, string> = {
  rendered: "Rendered",
  source: "Source",
  preview: "Preview",
};

/**
 * Status bar shown at the bottom of the editor window.
 *
 * Displays:
 * - Word count (debounced, updates on doc changes) — clickable to open stats popup
 * - Cursor position (line:column, updates on selection changes)
 * - Editor mode indicator (clickable to cycle Rendered → Source → Preview)
 *
 * Also owns the WritingStatsPopup. Mount its DOM node via `popupElement`.
 */
export class StatusBar {
  readonly element: HTMLElement;

  private readonly wordCountEl: HTMLElement;
  private readonly cursorPosEl: HTMLElement;
  private readonly modeEl: HTMLElement;

  private readonly statsPopup: WritingStatsPopup;

  private currentMode: EditorMode = "rendered";
  private onModeChange: ModeChangeHandler | null = null;
  private wordCountTimer: ReturnType<typeof setTimeout> | null = null;

  /** CM6 update listener extension — attach to the editor. */
  readonly extension: Extension;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "status-bar";

    this.statsPopup = new WritingStatsPopup();

    // Left side: word count (clickable — opens writing stats popup)
    this.wordCountEl = document.createElement("span");
    this.wordCountEl.className =
      "status-bar-item status-bar-words status-bar-clickable";
    this.wordCountEl.textContent = "0 words";
    this.wordCountEl.title = "Click for writing statistics";
    this.wordCountEl.addEventListener("click", () =>
      this.statsPopup.toggle(this.wordCountEl),
    );

    // Center: cursor position
    this.cursorPosEl = document.createElement("span");
    this.cursorPosEl.className = "status-bar-item status-bar-cursor";
    this.cursorPosEl.textContent = "Ln 1, Col 1";

    // Right side: mode indicator (clickable)
    this.modeEl = document.createElement("span");
    this.modeEl.className = "status-bar-item status-bar-mode";
    this.modeEl.title = "Click to cycle editor mode";
    this.modeEl.textContent = MODE_LABELS[this.currentMode];
    this.modeEl.addEventListener("click", () => this.cycleMode());

    const left = document.createElement("div");
    left.className = "status-bar-left";
    left.appendChild(this.wordCountEl);

    const center = document.createElement("div");
    center.className = "status-bar-center";
    center.appendChild(this.cursorPosEl);

    const right = document.createElement("div");
    right.className = "status-bar-right";
    right.appendChild(this.modeEl);

    this.element.appendChild(left);
    this.element.appendChild(center);
    this.element.appendChild(right);

    // CM6 extension — listens for doc changes (word count) and selection
    // changes (cursor position)
    this.extension = EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) {
        this.updateCursorPosition(update.view);
      }
      if (update.docChanged) {
        this.scheduleWordCount(update.view);
      }
    });
  }

  /**
   * The DOM element for the writing stats popup.
   * Append this to the app root so it can escape scroll containers.
   */
  get popupElement(): HTMLElement {
    return this.statsPopup.element;
  }

  /** Set the handler called when the user cycles the editor mode. */
  setModeChangeHandler(handler: ModeChangeHandler): void {
    this.onModeChange = handler;
  }

  /** Update the mode indicator without firing the change handler. */
  setMode(mode: EditorMode): void {
    this.currentMode = mode;
    this.modeEl.textContent = MODE_LABELS[mode];
  }

  /** Update word count and cursor position from an initial editor view. */
  syncFromView(view: EditorView): void {
    this.updateCursorPosition(view);
    this.updateWordCount(view);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private updateCursorPosition(view: EditorView): void {
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    const col = head - line.from + 1;
    this.cursorPosEl.textContent = `Ln ${line.number}, Col ${col}`;
  }

  private scheduleWordCount(view: EditorView): void {
    if (this.wordCountTimer !== null) {
      clearTimeout(this.wordCountTimer);
    }
    this.wordCountTimer = setTimeout(() => {
      this.wordCountTimer = null;
      try {
        this.updateWordCount(view);
      } catch {
        // view destroyed before timer fired
      }
    }, 300);
  }

  private updateWordCount(view: EditorView): void {
    const text = view.state.doc.toString();
    // Compute once; feed both the badge and the popup from the same result.
    const stats = computeDocStats(text);
    const count = stats.words;
    this.wordCountEl.textContent = count === 1 ? "1 word" : `${count} words`;
    this.statsPopup.update(stats);
  }

  private cycleMode(): void {
    const idx = MODE_ORDER.indexOf(this.currentMode);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    this.setMode(next);
    this.onModeChange?.(next);
  }
}
