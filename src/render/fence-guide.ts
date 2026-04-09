/**
 * Fenced div nesting guides.
 *
 * Draws vertical lines on the left edge of lines inside fenced divs
 * to indicate nesting depth. Only visible when the cursor is inside
 * a fenced div (editing mode). Each nesting level adds another line,
 * making it easy to see where blocks start and end.
 *
 * Uses a StateField with Decoration.line to add per-line depth classes.
 *
 * Performance: tracks the "active fenced-div path" (the set of FencedDiv
 * ancestors containing the cursor). When the cursor moves within the same
 * stack, the decorations are identical and the full rebuild is skipped.
 * Only crossing a fenced-div boundary or changing focus triggers a rebuild.
 */

import {
  type DecorationSet,
  Decoration,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  type EditorState,
  type Extension,
  type Range,
  StateField,
} from "@codemirror/state";
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { buildDecorations } from "./decoration-core";
import {
  editorFocusField,
  focusEffect,
  focusTracker,
} from "./focus-state";
import { documentSemanticsField } from "../semantics/codemirror-source";
import { NODE } from "../constants/node-types";
import { CSS } from "../constants/css-classes";
import { findAncestorByName } from "../lib/syntax-tree-helpers";
import {
  clearActiveFenceGuideClasses,
  syncActiveFenceGuideClasses,
} from "./source-widget";

interface FencedDivRange {
  from: number;
  to: number;
}

/** Collect all FencedDiv ranges from the syntax tree. */
function collectFencedDivRanges(state: EditorState): FencedDivRange[] {
  return state.field(documentSemanticsField).fencedDivs.map((div) => ({
    from: div.from,
    to: div.to,
  }));
}

/**
 * Compute a fingerprint of the fenced-div stack containing the cursor.
 *
 * Walks up the syntax tree from the cursor position to find all FencedDiv
 * ancestors. O(tree depth) instead of O(tree size). Returns an empty string
 * when unfocused or the cursor is outside any fenced div.
 */
function computeActivePath(state: EditorState): string {
  const focused = state.field(editorFocusField, false) ?? false;
  if (!focused) return "";

  const cursor = state.selection.main;
  const tree = syntaxTree(state);
  const parts: string[] = [];

  let node = tree.resolveInner(cursor.from);
  for (;;) {
    const fencedDiv = findAncestorByName(node, NODE.FencedDiv);
    if (!fencedDiv) break;
    if (cursor.from >= fencedDiv.from && cursor.to <= fencedDiv.to) {
      parts.push(`${fencedDiv.from}:${fencedDiv.to}`);
    }
    const parent = fencedDiv.parent;
    if (!parent) break;
    node = parent;
  }

  return parts.join(",");
}

/** Build fence guide decorations — only for divs containing the cursor. */
function buildFenceGuides(state: EditorState): DecorationSet {
  const focused = state.field(editorFocusField, false) ?? false;
  if (!focused) return Decoration.none;

  const cursor = state.selection.main;
  const allDivs = collectFencedDivRanges(state);

  // Find which FencedDivs contain the cursor
  const activeDivs = allDivs.filter(
    (d) => cursor.from >= d.from && cursor.to <= d.to,
  );

  if (activeDivs.length === 0) return Decoration.none;

  // Common case: single active div — all lines have the same depth.
  // Skip the Map overhead entirely: just walk lines once.
  if (activeDivs.length === 1) {
    const div = activeDivs[0];
    const startLine = state.doc.lineAt(div.from).number;
    const endLine = state.doc.lineAt(div.to).number;
    const items: Range<Decoration>[] = [];
    const deco = Decoration.line({ class: "cf-fence-guide cf-fence-d1" });
    for (let ln = startLine; ln <= endLine; ln++) {
      items.push(deco.range(state.doc.line(ln).from));
    }
    return buildDecorations(items);
  }

  // Multiple nesting levels: sweep-line with depth events at boundaries.
  // Collects +1 at div start line, -1 at div end line + 1, then walks
  // the covered line range once. O(activeDivs + totalLines) vs the
  // previous O(activeDivs * avgLinesPerDiv).
  const events = new Map<number, number>();
  let minLine = Infinity;
  let maxLine = -Infinity;
  for (const div of activeDivs) {
    const startLine = state.doc.lineAt(div.from).number;
    const endLine = state.doc.lineAt(div.to).number;
    events.set(startLine, (events.get(startLine) ?? 0) + 1);
    events.set(endLine + 1, (events.get(endLine + 1) ?? 0) - 1);
    if (startLine < minLine) minLine = startLine;
    if (endLine > maxLine) maxLine = endLine;
  }

  const items: Range<Decoration>[] = [];
  let depth = 0;
  for (let ln = minLine; ln <= maxLine; ln++) {
    const delta = events.get(ln);
    if (delta !== undefined) depth += delta;
    if (depth <= 0) continue;
    const d = Math.min(depth, 6);
    items.push(
      Decoration.line({
        class: `cf-fence-guide cf-fence-d${d}`,
      }).range(state.doc.line(ln).from),
    );
  }

  return buildDecorations(items);
}

function parseSourcePos(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

const BLOCK_WIDGET_SELECTOR = [
  `.${CSS.mathDisplay}`,
  `.${CSS.tableWidget}`,
  `.${CSS.imageWrapper}`,
  ".cf-block-caption",
  ".cf-embed",
].join(", ");

function syncFenceGuideWidgets(view: EditorView): void {
  const widgets = view.dom.querySelectorAll<HTMLElement>(BLOCK_WIDGET_SELECTOR);
  for (const widget of widgets) {
    if (widget.classList.contains(CSS.imageWrapper) && widget.tagName !== "DIV") {
      clearActiveFenceGuideClasses(widget);
      continue;
    }
    const from = parseSourcePos(widget.dataset.sourceFrom);
    const to = parseSourcePos(widget.dataset.sourceTo);
    if (from === null || to === null || to < from) {
      clearActiveFenceGuideClasses(widget);
      continue;
    }
    syncActiveFenceGuideClasses(widget, view, from, to);
  }
}

const fenceGuideWidgetView = ViewPlugin.fromClass(class {
  private syncScheduled = false;
  private frameId: number | null = null;

  constructor(view: EditorView) {
    syncFenceGuideWidgets(view);
    this.scheduleSync(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.focusChanged ||
      update.viewportChanged ||
      update.geometryChanged
    ) {
      syncFenceGuideWidgets(update.view);
      this.scheduleSync(update.view);
    }
  }

  private scheduleSync(view: EditorView): void {
    if (this.syncScheduled) return;
    this.syncScheduled = true;
    const run = (): void => {
      this.frameId = requestAnimationFrame(() => {
        this.frameId = null;
        this.syncScheduled = false;
        if (!view.dom.isConnected) return;
        syncFenceGuideWidgets(view);
      });
    };
    if (typeof requestAnimationFrame === "function") {
      run();
      return;
    }
    queueMicrotask(() => {
      this.syncScheduled = false;
      if (!view.dom.isConnected) return;
      syncFenceGuideWidgets(view);
    });
  }

  destroy(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }
});

// ── StateField with active-path caching ────────────────────────────────────

interface FenceGuideState {
  decorations: DecorationSet;
  /** Fingerprint of the active fenced-div stack for cheap equality check. */
  activePath: string;
}

function createFenceGuideState(state: EditorState): FenceGuideState {
  return {
    decorations: buildFenceGuides(state),
    activePath: computeActivePath(state),
  };
}

const fenceGuideField = StateField.define<FenceGuideState>({
  create: createFenceGuideState,

  update({ decorations, activePath }, tr) {
    // Tree changed: rebuild only when the parse is complete.
    // During progressive parsing, defer to avoid redundant rebuilds (#720).
    if (syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      if (syntaxTreeAvailable(tr.state, tr.state.doc.length)) {
        return createFenceGuideState(tr.state);
      }
      // Tree not yet complete — map positions if doc changed, else keep cached.
      if (tr.docChanged) {
        return { decorations: decorations.map(tr.changes), activePath };
      }
      return { decorations, activePath };
    }

    // Doc changed without tree change: map positions to preserve
    // RangeSet chunk identity for cheaper DOM reconciliation (#718).
    if (tr.docChanged) {
      return { decorations: decorations.map(tr.changes), activePath };
    }

    // Focus change: always rebuild (toggle visibility)
    if (tr.effects.some((e) => e.is(focusEffect))) {
      return createFenceGuideState(tr.state);
    }

    // Selection change: only rebuild if the active fenced-div path changed
    if (tr.selection !== undefined) {
      const newPath = computeActivePath(tr.state);
      if (newPath === activePath) {
        return { decorations, activePath };
      }
      return createFenceGuideState(tr.state);
    }

    // No relevant change
    return { decorations, activePath };
  },

  compare(a, b) {
    return a.decorations === b.decorations && a.activePath === b.activePath;
  },

  provide(field) {
    return EditorView.decorations.from(field, (s) => s.decorations);
  },
});

/** CM6 extension that draws vertical nesting guides for fenced divs (editing only). */
export const fenceGuidePlugin: Extension = [
  documentSemanticsField,
  editorFocusField,
  focusTracker,
  fenceGuideField,
  fenceGuideWidgetView,
];

// ── Test exports ───────────────────────────────────────────────────────────

export { computeActivePath as _computeActivePath_forTest };
export { buildFenceGuides as _buildFenceGuides_forTest };
export { fenceGuideField as _fenceGuideField_forTest };
