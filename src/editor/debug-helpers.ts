/**
 * Debug helpers exposed on `window.__cmDebug` for console and Playwright testing.
 *
 * Usage (browser console or Playwright page.evaluate):
 *   __cmDebug.tree()       — FencedDiv nodes from the Lezer syntax tree
 *   __cmDebug.treeString() — full syntax tree as readable string
 *   __cmDebug.fences()     — closing fence visibility for protected fenced blocks
 *   __cmDebug.line(73)     — DOM state of a specific line
 *   __cmDebug.dump()       — combined tree + fence status snapshot
 *   __cmDebug.toggleTreeView() — toggle live Lezer tree panel
 */

import { type EditorView } from "@codemirror/view";
import { undoDepth, redoDepth } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { toggleTreeView } from "./editor";
import {
  documentAnalysisField,
  getDocumentAnalysisRevisionInfo,
} from "../semantics/codemirror-source";
import { getClosingFenceRanges } from "../plugins/fence-protection";

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

interface DebugSnapshot {
  readonly divs: DivInfo[];
  readonly fences: FenceStatus[];
  readonly cursorLine: number;
  readonly focused: boolean;
  readonly semantics: SemanticDebugInfo;
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
    readonly includes: number;
  };
}

interface SelectionInfo {
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
  /** Return a combined snapshot of tree + fences + cursor state. */
  dump: () => DebugSnapshot;
  /** Toggle the live Lezer tree-view debug panel. Returns new on/off state. */
  toggleTreeView: () => boolean;
}

function getLineElement(view: EditorView, lineNum: number): HTMLElement | null {
  if (lineNum < 1 || lineNum > view.state.doc.lines) return null;
  const lineObj = view.state.doc.line(lineNum);
  const domPos = view.domAtPos(lineObj.from);
  let el: Node | null = domPos.node;
  if (el.nodeType === 3) el = el.parentNode;
  while (el && !(el instanceof HTMLElement && el.classList.contains("cm-line"))) {
    el = el.parentNode;
  }
  return el as HTMLElement | null;
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

    dump() {
      const cursor = view.state.selection.main;
      const cursorLine = view.state.doc.lineAt(cursor.from).number;
      return {
        divs: this.tree(),
        fences: this.fences(),
        cursorLine,
        focused: view.hasFocus,
        semantics: this.semantics(),
      };
    },

    toggleTreeView() {
      return toggleTreeView(view);
    },
  };
}
