import { Annotation, Transaction, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

const fencedDivReparseAnnotation = Annotation.define<true>();
const CLOSING_FENCE_LINE = /^[ \t]*:{3,}[ \t]*$/;

function changedLineHasClosingFence(update: ViewUpdate): boolean {
  let found = false;
  update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    if (found) return;
    const doc = update.state.doc;
    const startLine = doc.lineAt(Math.min(fromB, doc.length));
    const endLine = doc.lineAt(Math.min(Math.max(fromB, toB), doc.length));
    for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
      if (CLOSING_FENCE_LINE.test(doc.line(lineNumber).text)) {
        found = true;
        return;
      }
    }
  });
  return found;
}

/**
 * Work around a Lezer markdown fragment-reuse edge case for fenced divs.
 *
 * When a user incrementally types a body followed by the closing `:::`, Lezer
 * can reuse the previously parsed unclosed FencedDiv fragment before the closer
 * line is considered. A same-text replacement forces a fresh parse once, while
 * keeping the user-visible document and selection unchanged.
 */
const fencedDivIncrementalReparsePlugin = ViewPlugin.fromClass(class {
  private pending = false;

  constructor(private readonly view: EditorView) {}

  update(update: ViewUpdate): void {
    if (
      this.pending ||
      !update.docChanged ||
      update.transactions.some((tr) => tr.annotation(fencedDivReparseAnnotation))
      || !changedLineHasClosingFence(update)
    ) {
      return;
    }

    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      if (!this.view.dom.isConnected) return;
      const doc = this.view.state.doc.toString();
      this.view.dispatch({
        changes: { from: 0, to: this.view.state.doc.length, insert: doc },
        selection: this.view.state.selection,
        annotations: [
          fencedDivReparseAnnotation.of(true),
          Transaction.addToHistory.of(false),
        ],
        scrollIntoView: false,
      });
    });
  }
});

export const fencedDivIncrementalReparseExtension: Extension =
  fencedDivIncrementalReparsePlugin;
