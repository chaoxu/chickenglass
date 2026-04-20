/**
 * Debug helpers exposed on `window.__cmDebug` for console and Playwright testing.
 *
 * Usage (browser console or Playwright page.evaluate):
 *   __cmDebug.tree()       — FencedDiv nodes from the Lezer syntax tree
 *   __cmDebug.treeString() — full syntax tree as readable string
 *   __cmDebug.fences()     — closing fence visibility for protected fenced blocks
 *   __cmDebug.line(73)     — DOM state of a specific line
 *   __cmDebug.renderState() — compact visible rich-render snapshot
 *   __cmDebug.dump()       — combined tree + fence status snapshot
 *   __cmDebug.moveVertically("up") — apply rich-mode vertical motion with anomaly logging
 *   __cmDebug.toggleDebugLane() — toggle the shell/debug lane (red boxes + sidebar)
 *   __cmDebug.toggleTreeView() — toggle live Lezer tree panel
 */

import { type EditorView } from "@codemirror/view";
import { undoDepth, redoDepth } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import {
  isDebugLaneEnabled,
  toggleDebugLane,
  toggleTreeView,
} from "./editor";
import {
  documentAnalysisField,
  getDocumentAnalysisRevisionInfo,
} from "../state/document-analysis";
import { getClosingFenceRanges } from "../plugins/fence-protection";
import {
  clearVerticalMotionGuardEvents,
  getVerticalMotionGuardEvents,
  moveVerticallyInRichView,
  type VerticalMotionGuardEvent,
} from "./vertical-motion";
import {
  activateStructureEditAt,
  clearStructureEditTarget,
  getActiveStructureEditTarget,
  type StructureEditTarget,
} from "./structure-edit-state";
import {
  clearDebugTimelineEvents,
  getDebugTimelineEvents,
  type DebugTimelineEvent,
} from "./debug-timeline";
import {
  measureShellSurfaceSnapshot,
  type ShellSurfaceSnapshot,
} from "./shell-surface-model";

interface DivInfo {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

interface LineInfo {
  readonly line: number;
  readonly text: string;
  readonly classes: string[];
  readonly height: string;
  readonly hidden: boolean;
}

type FenceStatus = Pick<LineInfo, "line" | "height" | "hidden" | "classes">;

export interface VisibleRawFencedOpener {
  readonly line: number | null;
  readonly text: string;
  readonly classes: string[];
}

export interface DebugRenderState {
  readonly renderedBlockHeaders: number;
  readonly inlineMath: number;
  readonly displayMath: number;
  readonly citations: number;
  readonly crossrefs: number;
  readonly tables: number;
  readonly figures: number;
  readonly visibleRawFencedOpeners: readonly VisibleRawFencedOpener[];
}

interface DebugSnapshot {
  readonly divs: DivInfo[];
  readonly fences: FenceStatus[];
  readonly cursorLine: number;
  readonly focused: boolean;
  readonly semantics: SemanticDebugInfo;
  readonly structure: StructureEditTarget | null;
  readonly geometry: ShellSurfaceSnapshot;
  readonly render: DebugRenderState;
  readonly motionGuards: readonly VerticalMotionGuardEvent[];
  readonly timeline: readonly DebugTimelineEvent[];
}

interface SemanticDebugInfo {
  readonly revision: number;
  readonly slices: {
    readonly headings: number;
    readonly footnotes: number;
    readonly fencedDivs: number;
    readonly equations: number;
    readonly mathRegions: number;
    readonly references: number;
  };
}

export interface SelectionInfo {
  readonly anchor: number;
  readonly head: number;
  readonly from: number;
  readonly to: number;
  readonly empty: boolean;
  readonly line: number;
  readonly col: number;
}

export interface DebugHelpers {
  /** Return all FencedDiv nodes from the current syntax tree. */
  tree: () => DivInfo[];
  /** Return full syntax tree as a readable string (built-in CM6 format). */
  treeString: () => string;
  /** Return closing fence visibility for all protected fenced blocks. */
  fences: () => FenceStatus[];
  /** Return DOM state (classes, height, hidden) for a specific line number. */
  line: (lineNum: number) => LineInfo | null;
  /** Return current document-analysis revision info for perf/debug checks. */
  semantics: () => SemanticDebugInfo;
  /** Return current selection position, range, and line/column. */
  selection: () => SelectionInfo;
  /** Return undo/redo history depth. */
  history: () => { undoDepth: number; redoDepth: number };
  /** Return the active explicit structure-edit target, if any. */
  structure: () => StructureEditTarget | null;
  /** Return recent vertical-motion guard events for this editor instance. */
  motionGuards: () => readonly VerticalMotionGuardEvent[];
  /** Return recent debug timeline events for this editor instance. */
  timeline: () => readonly DebugTimelineEvent[];
  /** Return the current measured geometry snapshot for visible lines and shell surfaces. */
  geometry: () => ShellSurfaceSnapshot;
  /** Return a compact snapshot of the visible rich-render state. */
  renderState: () => DebugRenderState;
  /** Return a combined snapshot of tree + fences + cursor state. */
  dump: () => DebugSnapshot;
  /** Activate structure editing for the block/frontmatter at a document position. */
  activateStructureAt: (pos: number) => boolean;
  /** Activate structure editing at the current selection head. */
  activateStructureAtCursor: () => boolean;
  /** Clear the active structure-edit target. */
  clearStructure: () => boolean;
  /** Clear recorded vertical-motion guard events. */
  clearMotionGuards: () => void;
  /** Clear recorded debug timeline events. */
  clearTimeline: () => void;
  /** Run rich-mode vertical motion with anomaly logging. */
  moveVertically: (direction: "up" | "down") => boolean;
  /** Whether the shell/debug lane is currently enabled. */
  debugLaneEnabled: () => boolean;
  /** Toggle the shell/debug lane. Returns new on/off state. */
  toggleDebugLane: () => boolean;
  /** Toggle the live Lezer tree-view debug panel. Returns new on/off state. */
  toggleTreeView: () => boolean;
}

function getLineElement(view: EditorView, lineNum: number): HTMLElement | null {
  if (lineNum < 1 || lineNum > view.state.doc.lines) return null;
  const lines = view.contentDOM.querySelectorAll<HTMLElement>(".cm-line");
  for (const el of lines) {
    try {
      const pos = view.posAtDOM(el, 0);
      if (view.state.doc.lineAt(pos).number === lineNum) {
        return el;
      }
    } catch {
      continue;
    }
  }
  try {
    const lineObj = view.state.doc.line(lineNum);
    const domPos = view.domAtPos(lineObj.from);
    let el: Node | null = domPos.node;
    if (el.nodeType === Node.TEXT_NODE) el = el.parentNode;
    while (el && !(el instanceof HTMLElement && el.classList.contains("cm-line"))) {
      el = el.parentNode;
    }
    if (!(el instanceof HTMLElement)) return null;
    const pos = view.posAtDOM(el, 0);
    return view.state.doc.lineAt(pos).number === lineNum ? el : null;
  } catch {
    return null;
  }
}

function inspectLine(view: EditorView, lineNum: number): LineInfo | null {
  const el = getLineElement(view, lineNum);
  if (!el) return null;
  const cs = window.getComputedStyle(el);
  return {
    line: lineNum,
    text: el.textContent?.slice(0, 60) ?? "",
    classes: Array.from(el.classList).filter((c) => c.startsWith("cf-")),
    height: cs.height,
    hidden: cs.height === "0px",
  };
}

function isElementVisibleInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

function lineNumberAtElement(view: EditorView, el: HTMLElement): number | null {
  try {
    return view.state.doc.lineAt(view.posAtDOM(el, 0)).number;
  } catch {
    return null;
  }
}

function collectVisibleRawFencedOpeners(view: EditorView): VisibleRawFencedOpener[] {
  const result: VisibleRawFencedOpener[] = [];
  const lines = view.contentDOM.querySelectorAll<HTMLElement>(".cm-line");
  for (const line of lines) {
    if (!isElementVisibleInViewport(line)) continue;
    const visibleText = (line.innerText ?? "").trim();
    if (!visibleText) continue;
    if (!/^:{3,}/.test(visibleText)) continue;
    result.push({
      line: lineNumberAtElement(view, line),
      text: visibleText,
      classes: Array.from(line.classList).filter((name) => name.startsWith("cf-")),
    });
  }
  return result;
}

function measureRenderState(view: EditorView): DebugRenderState {
  const inView = (el: Element) => isElementVisibleInViewport(el);
  return {
    renderedBlockHeaders: Array.from(
      view.dom.querySelectorAll(".cf-block-header-rendered"),
    ).filter(inView).length,
    inlineMath: Array.from(view.dom.querySelectorAll(".cf-math-inline")).filter(inView).length,
    displayMath: Array.from(view.dom.querySelectorAll(".cf-math-display")).filter(inView).length,
    citations: Array.from(view.dom.querySelectorAll(".cf-citation")).filter(inView).length,
    crossrefs: Array.from(
      view.dom.querySelectorAll(".cf-crossref, .cross-ref"),
    ).filter(inView).length,
    tables: Array.from(view.dom.querySelectorAll(".cf-table-widget")).filter(inView).length,
    figures: Array.from(
      view.dom.querySelectorAll(".cf-block-figure, .cf-image-wrapper"),
    ).filter(inView).length,
    visibleRawFencedOpeners: collectVisibleRawFencedOpeners(view),
  };
}

export function createDebugHelpers(view: EditorView): DebugHelpers {
  return {
    tree() {
      const state = view.state;
      const tree = syntaxTree(state);
      const divs: DivInfo[] = [];
      tree.iterate({
        enter(node) {
          if (node.type.name === "FencedDiv") {
            divs.push({
              from: node.from,
              to: node.to,
              text: state.doc.sliceString(node.from, Math.min(node.to, node.from + 40)),
            });
          }
        },
      });
      return divs;
    },

    treeString() {
      return syntaxTree(view.state).toString();
    },

    fences() {
      const results: FenceStatus[] = [];
      for (const range of getClosingFenceRanges(view.state)) {
        const lineNumber = view.state.doc.lineAt(range.from).number;
        const info = inspectLine(view, lineNumber);
        if (info) {
          const { line, height, hidden, classes } = info;
          results.push({ line, height, hidden, classes });
        } else {
          results.push({
            line: lineNumber,
            height: "0px",
            hidden: true,
            classes: [],
          });
        }
      }
      return results;
    },

    line(lineNum: number) {
      return inspectLine(view, lineNum);
    },

    semantics() {
      return getDocumentAnalysisRevisionInfo(
        view.state.field(documentAnalysisField),
      );
    },

    selection() {
      const sel = view.state.selection.main;
      const line = view.state.doc.lineAt(sel.head);
      return {
        anchor: sel.anchor,
        head: sel.head,
        from: sel.from,
        to: sel.to,
        empty: sel.empty,
        line: line.number,
        col: sel.head - line.from + 1,
      };
    },

    history() {
      return {
        undoDepth: undoDepth(view.state),
        redoDepth: redoDepth(view.state),
      };
    },

    structure() {
      return getActiveStructureEditTarget(view.state);
    },

    motionGuards() {
      return getVerticalMotionGuardEvents(view);
    },

    timeline() {
      return getDebugTimelineEvents(view);
    },

    geometry() {
      return measureShellSurfaceSnapshot(view);
    },

    renderState() {
      return measureRenderState(view);
    },

    dump() {
      const cursor = view.state.selection.main;
      const cursorLine = view.state.doc.lineAt(cursor.from).number;
      return {
        divs: this.tree(),
        fences: this.fences(),
        cursorLine,
        focused: view.hasFocus,
        semantics: this.semantics(),
        structure: this.structure(),
        geometry: this.geometry(),
        render: this.renderState(),
        motionGuards: this.motionGuards(),
        timeline: this.timeline(),
      };
    },

    activateStructureAt(pos: number) {
      return activateStructureEditAt(view, pos);
    },

    activateStructureAtCursor() {
      return activateStructureEditAt(view, view.state.selection.main.head);
    },

    clearStructure() {
      return clearStructureEditTarget(view);
    },

    clearMotionGuards() {
      clearVerticalMotionGuardEvents(view);
    },

    clearTimeline() {
      clearDebugTimelineEvents(view);
    },

    moveVertically(direction: "up" | "down") {
      return moveVerticallyInRichView(view, direction === "down");
    },

    debugLaneEnabled() {
      return isDebugLaneEnabled(view);
    },

    toggleDebugLane() {
      return toggleDebugLane(view);
    },

    toggleTreeView() {
      return toggleTreeView(view);
    },
  };
}
