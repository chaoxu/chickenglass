import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { EditorMode } from "../editor";

/** Callback invoked when the user clicks the mode indicator to cycle modes. */
export type ModeChangeHandler = (mode: EditorMode) => void;

const MODE_ORDER: EditorMode[] = ["rendered", "source", "preview"];
const MODE_LABELS: Record<EditorMode, string> = {
  rendered: "Rendered",
  source: "Source",
  preview: "Preview",
};

/** Count words in a markdown document, ignoring frontmatter fences and blank lines. */
function countWords(text: string): number {
  // Strip YAML frontmatter delimited by leading ---
  const withoutFrontmatter = text.replace(/^---[\s\S]*?---\n?/, "");
  // Split on whitespace and filter empty tokens
  const tokens = withoutFrontmatter.split(/\s+/).filter((t) => t.length > 0);
  return tokens.length;
}

/**
 * Status bar shown at the bottom of the editor window.
 *
 * Displays:
 * - Word count (debounced, updates on doc changes)
 * - Cursor position (line:column, updates on selection changes)
 * - Editor mode indicator (clickable to cycle Rendered → Source → Preview)
 */
export class StatusBar {
  readonly element: HTMLElement;

  private readonly wordCountEl: HTMLElement;
  private readonly cursorPosEl: HTMLElement;
  private readonly modeEl: HTMLElement;

  private currentMode: EditorMode = "rendered";
  private onModeChange: ModeChangeHandler | null = null;
  private wordCountTimer: ReturnType<typeof setTimeout> | null = null;

  /** CM6 update listener extension — attach to the editor. */
  readonly extension: Extension;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "status-bar";

    // Left side: word count
    this.wordCountEl = document.createElement("span");
    this.wordCountEl.className = "status-bar-item status-bar-words";
    this.wordCountEl.textContent = "0 words";

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
    const count = countWords(text);
    this.wordCountEl.textContent = count === 1 ? "1 word" : `${count} words`;
  }

  private cycleMode(): void {
    const idx = MODE_ORDER.indexOf(this.currentMode);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    this.setMode(next);
    this.onModeChange?.(next);
  }
}
