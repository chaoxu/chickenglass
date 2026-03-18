import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { EditorSelection, Prec, type Extension } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import { toggleDebugInspector } from "../render/debug-inspector";
import { toggleFocusMode } from "../render/focus-mode";
import type { SourceMap } from "../app/source-map";

/**
 * Jump to the source file when cursor is in an include region.
 * Dispatches a custom DOM event that the App listens for.
 */
function jumpToSourceFile(view: EditorView): boolean {
  const sourceMap = (
    window as unknown as { __cgSourceMap?: SourceMap | null }
  ).__cgSourceMap;
  if (!sourceMap) return false;

  const pos = view.state.selection.main.head;
  const region = sourceMap.regionAt(pos);
  if (!region) return false;

  view.dom.dispatchEvent(
    new CustomEvent("cg-open-file", { detail: region.file, bubbles: true }),
  );
  return true;
}

// ---------------------------------------------------------------------------
// Inline formatting toggle helpers
// ---------------------------------------------------------------------------

/**
 * Toggle symmetric inline markers (e.g. `**`, `*`, `` ` ``, `~~`, `==`).
 *
 * - With selection: if the selected text is already wrapped with the marker,
 *   unwrap it; otherwise wrap it.
 * - Without selection: insert a pair of markers and place the cursor between
 *   them.
 */
export function toggleInlineMarker(
  view: EditorView,
  marker: string,
): boolean {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);

    if (range.from === range.to) {
      // No selection — check surrounding text for existing markers
      const mLen = marker.length;
      const before = state.sliceDoc(
        Math.max(0, range.from - mLen),
        range.from,
      );
      const after = state.sliceDoc(range.to, range.to + mLen);

      if (before === marker && after === marker) {
        // Cursor is between markers — remove them
        return {
          changes: [
            { from: range.from - mLen, to: range.from },
            { from: range.to, to: range.to + mLen },
          ],
          range: EditorSelection.cursor(range.from - mLen),
        };
      }

      // Insert marker pair and place cursor in between
      const insert = marker + marker;
      return {
        changes: { from: range.from, insert },
        range: EditorSelection.cursor(range.from + mLen),
      };
    }

    // Has selection — check if already wrapped
    if (
      selected.startsWith(marker) &&
      selected.endsWith(marker) &&
      selected.length >= marker.length * 2
    ) {
      // Unwrap: remove markers from selection
      const inner = selected.slice(marker.length, -marker.length);
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      };
    }

    // Also check text just outside the selection
    const mLen = marker.length;
    const before = state.sliceDoc(
      Math.max(0, range.from - mLen),
      range.from,
    );
    const after = state.sliceDoc(range.to, range.to + mLen);

    if (before === marker && after === marker) {
      // Selection is already wrapped externally — unwrap
      return {
        changes: [
          { from: range.from - mLen, to: range.from },
          { from: range.to, to: range.to + mLen },
        ],
        range: EditorSelection.range(
          range.from - mLen,
          range.to - mLen,
        ),
      };
    }

    // Wrap selection
    const insert = marker + selected + marker;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(
        range.from + mLen,
        range.from + mLen + selected.length,
      ),
    };
  });

  view.dispatch(changes, { userEvent: "input.format" });
  return true;
}

/**
 * Toggle a markdown link around the selection.
 *
 * - With selection already in `[text](url)` form: unwrap to just `text`.
 * - With selection: wrap as `[selection](url)` and select "url".
 * - Without selection: insert `[](url)` and place cursor inside brackets.
 */
export function toggleLink(view: EditorView): boolean {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);

    // Check if selection is already a link: [text](url)
    const linkRe = /^\[([^\]]*)\]\(([^)]*)\)$/;
    const match = linkRe.exec(selected);
    if (match) {
      // Unwrap — keep just the link text
      const text = match[1];
      return {
        changes: { from: range.from, to: range.to, insert: text },
        range: EditorSelection.range(range.from, range.from + text.length),
      };
    }

    // Also check if the text surrounding the selection forms a link
    const beforeBracket = state.sliceDoc(
      Math.max(0, range.from - 1),
      range.from,
    );
    const afterPart = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + 50));
    const closingMatch = /^\]\(([^)]*)\)/.exec(afterPart);

    if (beforeBracket === "[" && closingMatch) {
      // Cursor/selection is inside a link's text portion — unwrap
      const fullEnd = range.to + closingMatch[0].length;
      return {
        changes: [
          { from: range.from - 1, to: range.from },
          { from: range.to, to: fullEnd },
        ],
        range: EditorSelection.range(
          range.from - 1,
          range.to - 1,
        ),
      };
    }

    if (range.from === range.to) {
      // No selection — insert empty link template
      const insert = "[](url)";
      return {
        changes: { from: range.from, insert },
        range: EditorSelection.cursor(range.from + 1),
      };
    }

    // Wrap selection as link text
    const insert = `[${selected}](url)`;
    const urlStart = range.from + 1 + selected.length + 2; // after "[selected]("
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlStart, urlStart + 3),
    };
  });

  view.dispatch(changes, { userEvent: "input.format" });
  return true;
}

// Convenience command wrappers
const toggleBold = (view: EditorView): boolean =>
  toggleInlineMarker(view, "**");
const toggleItalic = (view: EditorView): boolean =>
  toggleInlineMarker(view, "*");
const toggleInlineCode = (view: EditorView): boolean =>
  toggleInlineMarker(view, "`");
const toggleStrikethrough = (view: EditorView): boolean =>
  toggleInlineMarker(view, "~~");
const toggleHighlight = (view: EditorView): boolean =>
  toggleInlineMarker(view, "==");

/** Default keybindings for the editor. */
export const editorKeybindings: Extension = [
  history(),
  keymap.of([
    ...defaultKeymap,
    ...historyKeymap,
    indentWithTab,
    { key: "Mod-Shift-d", run: toggleDebugInspector },
    { key: "Mod-Shift-f", run: toggleFocusMode },
    { key: "Mod-Shift-o", run: jumpToSourceFile },
  ]),
  // Formatting shortcuts at high precedence so they override defaults
  Prec.high(
    keymap.of([
      { key: "Mod-b", run: toggleBold },
      { key: "Mod-i", run: toggleItalic },
      { key: "Mod-k", run: toggleLink },
      { key: "Mod-Shift-k", run: toggleInlineCode },
      { key: "Mod-Shift-x", run: toggleStrikethrough },
      { key: "Mod-Shift-h", run: toggleHighlight },
    ]),
  ),
];
