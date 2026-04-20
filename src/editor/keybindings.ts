import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { MODE_CHANGE_EVENT } from "../constants/events";
import { getClosingFenceRanges } from "../plugins/fence-protection";
import { toggleDebugInspector } from "../render/debug-inspector";
import { toggleFocusMode } from "../render/focus-mode";
import { editorModeField, markdownEditorModes, setEditorMode } from "./editor";
import { clearStructureEditTarget } from "./structure-edit-state";
import { moveVerticallyInRichView } from "./vertical-motion";

/** Cycle to the next editor mode. */
function cycleEditorMode(view: EditorView): boolean {
  // Read the current mode from the CM6 StateField so the cycle stays in sync
  // with React state (e.g., when the app switches modes programmatically).
  const currentMode = view.state.field(editorModeField, false) ?? "rich";
  const nextMode = markdownEditorModes[
    (markdownEditorModes.indexOf(currentMode) + 1) % markdownEditorModes.length
  ];
  setEditorMode(view, nextMode);

  // Dispatch a DOM event so the app can update the UI indicator
  view.dom.dispatchEvent(
    new CustomEvent(MODE_CHANGE_EVENT, { detail: nextMode, bubbles: true }),
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
 * Walk up the Lezer syntax tree from a document position to find the
 * innermost enclosing Link node. Returns null when no Link ancestor exists.
 *
 * Tries bias 1 first (looks right from `pos`) so that a cursor placed at the
 * opening `[` — the first character of the Link node — is still resolved
 * inside the Link rather than at the end of the preceding text node. Falls
 * back to bias -1 for positions at the very end of a Link (e.g., the closing
 * `)`), and finally bias 0 as a tiebreaker.
 */
function findLinkNodeAt(state: EditorState, pos: number): SyntaxNode | null {
  const tree = syntaxTree(state);
  for (const bias of [1, -1, 0] as const) {
    let node: SyntaxNode | null = tree.resolveInner(pos, bias);
    while (node) {
      if (node.name === "Link") return node;
      node = node.parent;
    }
  }
  return null;
}

/**
 * Extract the visible link text from a Link SyntaxNode.
 *
 * The text lives between the first two LinkMark children (`[` and `]`).
 * Returns an empty string when no text range can be determined.
 */
function extractLinkText(state: EditorState, linkNode: SyntaxNode): string {
  let child = linkNode.firstChild;
  let openMark: { to: number } | null = null;
  while (child) {
    if (child.name === "LinkMark") {
      if (!openMark) {
        openMark = child;
      } else {
        // Second LinkMark is "]" — text is between open.to and child.from
        return state.sliceDoc(openMark.to, child.from);
      }
    }
    child = child.nextSibling;
  }
  return "";
}

/**
 * Toggle a markdown link around the selection.
 *
 * - Cursor/selection inside an existing Link node: unwrap to just the link
 *   text. Link detection uses the Lezer syntax tree so it works for any URL
 *   length and for cursors anywhere inside the link, not just after `[`.
 * - With selection (not in a link): wrap as `[selection](url)` and select
 *   the placeholder "url".
 * - Without selection (not in a link): insert `[](url)` and place cursor
 *   inside the brackets.
 */
export function toggleLink(view: EditorView): boolean {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    // Use the Lezer tree to find an enclosing Link at the start of the range.
    // For a selection that spans an entire link, the from position is on `[`
    // which is also inside the Link node.
    const linkNode = findLinkNodeAt(state, range.from);

    if (linkNode) {
      // Unwrap: replace the full Link span with just the link text
      const text = extractLinkText(state, linkNode);
      return {
        changes: { from: linkNode.from, to: linkNode.to, insert: text },
        range: EditorSelection.range(linkNode.from, linkNode.from + text.length),
      };
    }

    if (range.from === range.to) {
      // No selection and not inside a link — insert empty link template
      const insert = "[](url)";
      return {
        changes: { from: range.from, insert },
        range: EditorSelection.cursor(range.from + 1),
      };
    }

    // Selection not inside a link — wrap as link text
    const selected = state.sliceDoc(range.from, range.to);
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

function makeToggleInlineMarkerCommand(
  marker: string,
): (view: EditorView) => boolean {
  return (view) => toggleInlineMarker(view, marker);
}

const toggleBold = makeToggleInlineMarkerCommand("**");
const toggleItalic = makeToggleInlineMarkerCommand("*");
const toggleInlineCode = makeToggleInlineMarkerCommand("`");
const toggleStrikethrough = makeToggleInlineMarkerCommand("~~");
const toggleHighlight = makeToggleInlineMarkerCommand("==");

function isRichMode(view: EditorView): boolean {
  return (view.state.field(editorModeField, false) ?? "rich") === "rich";
}

function closingFenceLineStarts(state: EditorState): Set<number> {
  return new Set(
    getClosingFenceRanges(state).map((range) => state.doc.lineAt(range.from).from),
  );
}

/**
 * Preserve parent-level insertion points when ArrowDown exits nested blocks.
 *
 * Hidden closing fences are atomic, so CM6's default vertical motion can jump
 * from the last visible child line to after every adjacent closing fence at
 * once. When consecutive hidden closing fences exist, stop on the next outer
 * closing-fence line start so the user can keep typing inside the parent.
 */
export function moveDownAcrossNestedClosingFences(view: EditorView): boolean {
  if (!isRichMode(view)) return false;

  const range = view.state.selection.main;
  if (!range.empty) return false;

  const closingStarts = closingFenceLineStarts(view.state);
  if (closingStarts.size === 0) return false;

  const currentLine = view.state.doc.lineAt(range.head);
  const currentLineIsClosing = closingStarts.has(currentLine.from);

  // Repeated ArrowDown presses from an existing hidden closing-fence position
  // should advance one structural level at a time across consecutive closers.
  if (currentLineIsClosing) {
    if (currentLine.number >= view.state.doc.lines) return false;
    const nextLine = view.state.doc.line(currentLine.number + 1);
    if (!closingStarts.has(nextLine.from)) return false;
    view.dispatch({
      selection: { anchor: nextLine.from },
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  }

  if (range.head !== currentLine.to || currentLine.number >= view.state.doc.lines - 1) {
    return false;
  }

  const firstClosingLine = view.state.doc.line(currentLine.number + 1);
  if (!closingStarts.has(firstClosingLine.from)) return false;

  const targetLine = view.state.doc.line(currentLine.number + 2);
  if (!closingStarts.has(targetLine.from)) return false;

  view.dispatch({
    selection: { anchor: targetLine.from },
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

function moveWithReverseScrollGuard(
  view: EditorView,
  direction: "up" | "down",
): boolean {
  if (!isRichMode(view)) return false;
  const movingDown = direction === "down";
  return (movingDown && moveDownAcrossNestedClosingFences(view))
    || moveVerticallyInRichView(view, movingDown);
}

const richVerticalMotionDomHandlers: Extension = EditorView.domEventHandlers({
  keydown(event, view) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
    if (!isRichMode(view)) return false;

    const handled = moveWithReverseScrollGuard(
      view,
      event.key === "ArrowDown" ? "down" : "up",
    );
    if (!handled) return false;

    event.preventDefault();
    event.stopPropagation();
    return true;
  },
});

function clearActiveStructureEdit(view: EditorView): boolean {
  return clearStructureEditTarget(view);
}

/** Default keybindings for the editor. */
export const editorKeybindings: Extension = [
  history(),
  richVerticalMotionDomHandlers,
  Prec.high(
    keymap.of([
      { key: "Escape", run: clearActiveStructureEdit },
      { key: "ArrowUp", run: (view) => moveWithReverseScrollGuard(view, "up") },
      { key: "ArrowDown", run: (view) => moveWithReverseScrollGuard(view, "down") },
    ]),
  ),
  keymap.of([
    ...defaultKeymap,
    ...historyKeymap,
    indentWithTab,
    { key: "Mod-Shift-d", run: toggleDebugInspector },
    { key: "Mod-Shift-f", run: toggleFocusMode },
    { key: "Mod-Shift-m", run: cycleEditorMode },
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
