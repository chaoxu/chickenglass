/**
 * Debug helpers exposed on `window.__cmDebug` for console and Playwright testing.
 *
 * Usage (browser console or Playwright page.evaluate):
 *   __cmDebug.tree()       — FencedDiv nodes from the Lezer syntax tree
 *   __cmDebug.treeString() — full syntax tree as readable string
 *   __cmDebug.fences()     — closing fence visibility for all fenced divs
 *   __cmDebug.line(73)     — DOM state of a specific line
 *   __cmDebug.dump()       — combined tree + fence status snapshot
 *   __cmDebug.toggleTreeView() — toggle live Lezer tree panel
 */

import { type EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { toggleTreeView } from "./editor";

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
}

export interface DebugHelpers {
  /** Return all FencedDiv nodes from the current syntax tree. */
  tree: () => DivInfo[];
  /** Return full syntax tree as a readable string (built-in CM6 format). */
  treeString: () => string;
  /** Return closing fence visibility for all fenced div blocks. */
  fences: () => FenceStatus[];
  /** Return DOM state (classes, height, hidden) for a specific line number. */
  line: (lineNum: number) => LineInfo | null;
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
    classes: Array.from(el.classList).filter((c) => c.startsWith("cg-")),
    height: cs.height,
    hidden: cs.height === "0px",
  };
}

/** Regex matching a closing fence line: 3+ colons followed by optional whitespace. */
const CLOSING_FENCE_RE = /^:{3,}\s*$/;

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
      const doc = view.state.doc;
      const results: FenceStatus[] = [];
      for (let i = 1; i <= doc.lines; i++) {
        const lineText = doc.line(i).text;
        if (CLOSING_FENCE_RE.test(lineText.trimStart())) {
          const info = inspectLine(view, i);
          if (info) {
            const { line, height, hidden, classes } = info;
            results.push({ line, height, hidden, classes });
          }
        }
      }
      return results;
    },

    line(lineNum: number) {
      return inspectLine(view, lineNum);
    },

    dump() {
      const cursor = view.state.selection.main;
      const cursorLine = view.state.doc.lineAt(cursor.from).number;
      return {
        divs: this.tree(),
        fences: this.fences(),
        cursorLine,
        focused: view.hasFocus,
      };
    },

    toggleTreeView() {
      return toggleTreeView(view);
    },
  };
}
