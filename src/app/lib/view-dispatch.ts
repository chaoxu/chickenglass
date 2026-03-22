import type { TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface DispatchIfConnectedOptions {
  /**
   * Prefix logged when a connected view still throws during dispatch.
   * Falls back to a generic message.
   */
  readonly context?: string;
}

/**
 * Dispatch to an EditorView only when its DOM is still connected.
 *
 * Async/background tasks race with editor teardown. This helper standardizes
 * the "dispatch if alive, otherwise noop" pattern so background loaders do not
 * throw into the console after the user switches files or the editor unmounts.
 *
 * Returns true when dispatch ran, false when skipped or when dispatch threw.
 */
export function dispatchIfConnected(
  view: EditorView,
  spec: TransactionSpec,
  options: DispatchIfConnectedOptions = {},
): boolean {
  if (!view.dom.isConnected) return false;

  try {
    view.dispatch(spec);
    return true;
  } catch (err) {
    if (view.dom.isConnected) {
      console.error(options.context ?? "Editor dispatch error:", err);
    }
    return false;
  }
}
