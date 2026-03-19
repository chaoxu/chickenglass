/**
 * Go to Line dialog.
 *
 * A lightweight overlay input accessible via Cmd+G (or Ctrl+G).
 * Accepts "line" or "line:column" format.
 * Enter jumps the cursor to that position; Escape dismisses.
 * The placeholder shows the current line number.
 */

import type { EditorView } from "@codemirror/view";

/**
 * Parse a "line" or "line:col" string into a { line, col } object.
 * Returns null if the input is not a valid number.
 * Both line and col are 1-based.
 */
export function parseTarget(
  raw: string,
): { line: number; col: number } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(":");
  const lineNum = parseInt(parts[0], 10);
  if (!Number.isFinite(lineNum) || lineNum < 1) return null;

  const colNum = parts.length >= 2 ? parseInt(parts[1], 10) : 1;
  const col = Number.isFinite(colNum) && colNum >= 1 ? colNum : 1;

  return { line: lineNum, col };
}

/**
 * Navigate an EditorView to the given 1-based line and column.
 * Clamps values to the document bounds and scrolls into view.
 */
function jumpTo(view: EditorView, line: number, col: number): void {
  const doc = view.state.doc;
  const clampedLine = Math.max(1, Math.min(line, doc.lines));
  const lineObj = doc.line(clampedLine);
  const clampedCol = Math.max(0, Math.min(col - 1, lineObj.length));
  const pos = lineObj.from + clampedCol;
  view.dispatch({
    selection: { anchor: pos },
    scrollIntoView: true,
  });
  view.focus();
}

/**
 * Get the current 1-based line number of the main cursor.
 */
function currentLineNumber(view: EditorView): number {
  const pos = view.state.selection.main.head;
  return view.state.doc.lineAt(pos).number;
}

/**
 * Go-to-line overlay component.
 *
 * Shows a small, compact input overlay near the top-center of the editor.
 * Much simpler than the command palette — no results list, just one input.
 */
export class GotoLineDialog {
  readonly element: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly input: HTMLInputElement;

  private visible = false;
  private view: EditorView | null = null;

  constructor() {
    // Backdrop dismisses the dialog on click
    this.backdrop = document.createElement("div");
    this.backdrop.className = "goto-line-backdrop";
    this.backdrop.addEventListener("click", () => this.close());

    // Small input panel
    this.panel = document.createElement("div");
    this.panel.className = "goto-line-panel";

    this.input = document.createElement("input");
    this.input.className = "goto-line-input";
    this.input.type = "text";
    this.input.setAttribute("aria-label", "Go to line");
    this.panel.appendChild(this.input);

    const hint = document.createElement("div");
    hint.className = "goto-line-hint";
    hint.textContent = "line or line:column — Enter to jump, Esc to dismiss";
    this.panel.appendChild(hint);

    // Outer wrapper holds backdrop + panel
    this.element = document.createElement("div");
    this.element.className = "goto-line-overlay";
    this.element.style.display = "none";
    this.element.appendChild(this.backdrop);
    this.element.appendChild(this.panel);

    this.panel.addEventListener("keydown", (e) => this.onKeyDown(e));
  }

  /** Associate an editor view (updated when editor switches). */
  setView(view: EditorView): void {
    this.view = view;
  }

  /** Open the dialog, showing the current line as a placeholder. */
  open(): void {
    this.visible = true;
    this.element.style.display = "";
    this.input.value = "";

    if (this.view) {
      const line = currentLineNumber(this.view);
      this.input.placeholder = String(line);
    } else {
      this.input.placeholder = "1";
    }

    this.input.focus();
  }

  /** Close the dialog and return focus to the editor. */
  close(): void {
    this.visible = false;
    this.element.style.display = "none";
    this.view?.focus();
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

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      this.commit();
      return;
    }
  }

  /** Parse the input and jump to the target position. */
  private commit(): void {
    if (!this.view) {
      this.close();
      return;
    }

    // Empty input → use the placeholder (current line), i.e., no-op jump
    const raw = this.input.value.trim() || this.input.placeholder;
    const target = parseTarget(raw);
    if (target) {
      jumpTo(this.view, target.line, target.col);
    }
    this.close();
  }
}

/**
 * Install the Cmd+G / Ctrl+G keybinding for the Go to Line dialog.
 *
 * Returns a cleanup function that removes the event listener.
 */
export function installGotoLineKeybinding(
  root: HTMLElement,
  dialog: GotoLineDialog,
): () => void {
  const handler = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "g") {
      e.preventDefault();
      dialog.toggle();
    }
  };
  root.addEventListener("keydown", handler);
  return () => root.removeEventListener("keydown", handler);
}
