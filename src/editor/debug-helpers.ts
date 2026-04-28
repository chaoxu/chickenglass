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
  clearVerticalMotionGuardEvents,
  moveVerticallyInRichView,
  type VerticalMotionGuardEvent,
} from "./vertical-motion";
import {
  activateStructureEditAt,
  clearStructureEditTarget,
  type StructureEditTarget,
} from "../state/cm-structure-edit";
import {
  clearDebugTimelineEvents,
  type DebugTimelineEvent,
} from "./debug-timeline";
import type { ShellSurfaceSnapshot } from "./shell-surface-model";
import type {
  DebugRenderState,
  SelectionInfo,
} from "../lib/debug-types";
import {
  collectDebugFenceStatuses,
  collectDebugTreeDivs,
  getDebugSelectionInfo,
  getDebugSemanticInfo,
  getDebugSnapshot,
  getDebugStructureTarget,
  getDebugMotionGuards,
  getDebugTimeline,
  inspectDebugLine,
  measureDebugGeometry,
  measureDebugRenderState,
  type DebugDivInfo,
  type DebugFenceStatus,
  type DebugLineInfo,
  type DebugSnapshot,
  type SemanticDebugInfo,
} from "./debug-snapshot";
export type {
  DebugRenderState,
  SelectionInfo,
  VisibleRawFencedOpener,
} from "../lib/debug-types";
export type { DebugSnapshot } from "./debug-snapshot";

export interface DebugHelpers {
  /** Return all FencedDiv nodes from the current syntax tree. */
  tree: () => DebugDivInfo[];
  /** Return full syntax tree as a readable string (built-in CM6 format). */
  treeString: () => string;
  /** Return closing fence visibility for all protected fenced blocks. */
  fences: () => DebugFenceStatus[];
  /** Return DOM state (classes, height, hidden) for a specific line number. */
  line: (lineNum: number) => DebugLineInfo | null;
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

export function createDebugHelpers(view: EditorView): DebugHelpers {
  return {
    tree() {
      return collectDebugTreeDivs(view);
    },

    treeString() {
      return syntaxTree(view.state).toString();
    },

    fences() {
      return collectDebugFenceStatuses(view);
    },

    line(lineNum: number) {
      return inspectDebugLine(view, lineNum);
    },

    semantics() {
      return getDebugSemanticInfo(view);
    },

    selection() {
      return getDebugSelectionInfo(view);
    },

    history() {
      return {
        undoDepth: undoDepth(view.state),
        redoDepth: redoDepth(view.state),
      };
    },

    structure() {
      return getDebugStructureTarget(view);
    },

    motionGuards() {
      return getDebugMotionGuards(view);
    },

    timeline() {
      return getDebugTimeline(view);
    },

    geometry() {
      return measureDebugGeometry(view);
    },

    renderState() {
      return measureDebugRenderState(view);
    },

    dump() {
      return getDebugSnapshot(view);
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
