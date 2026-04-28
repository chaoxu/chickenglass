import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { getClosingFenceRanges } from "../plugins/fence-protection";
import {
  documentAnalysisField,
  getDocumentAnalysisRevisionInfo,
} from "../state/document-analysis";
import {
  getActiveStructureEditTarget,
  type StructureEditTarget,
} from "../state/cm-structure-edit";
import type {
  DebugRenderState,
  SelectionInfo,
  VisibleRawFencedOpener,
} from "../lib/debug-types";
import {
  measureShellSurfaceSnapshot,
  type ShellSurfaceSnapshot,
} from "./shell-surface-model";
import {
  getVerticalMotionGuardEvents,
  type VerticalMotionGuardEvent,
} from "./vertical-motion";
import {
  getDebugTimelineEvents,
  type DebugTimelineEvent,
} from "./debug-timeline";

export interface DebugDivInfo {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export interface DebugLineInfo {
  readonly line: number;
  readonly text: string;
  readonly classes: string[];
  readonly height: string;
  readonly hidden: boolean;
}

export type DebugFenceStatus = Pick<
  DebugLineInfo,
  "line" | "height" | "hidden" | "classes"
>;

export interface SemanticDebugInfo {
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

export interface DebugSnapshot {
  readonly divs: DebugDivInfo[];
  readonly fences: DebugFenceStatus[];
  readonly cursorLine: number;
  readonly focused: boolean;
  readonly semantics: SemanticDebugInfo;
  readonly structure: StructureEditTarget | null;
  readonly geometry: ShellSurfaceSnapshot;
  readonly render: DebugRenderState;
  readonly motionGuards: readonly VerticalMotionGuardEvent[];
  readonly timeline: readonly DebugTimelineEvent[];
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
    } catch (_error) {
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
  } catch (_error) {
    return null;
  }
}

export function inspectDebugLine(
  view: EditorView,
  lineNum: number,
): DebugLineInfo | null {
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

export function collectDebugTreeDivs(view: EditorView): DebugDivInfo[] {
  const state = view.state;
  const tree = syntaxTree(state);
  const divs: DebugDivInfo[] = [];
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
}

export function collectDebugFenceStatuses(view: EditorView): DebugFenceStatus[] {
  const results: DebugFenceStatus[] = [];
  for (const range of getClosingFenceRanges(view.state)) {
    const lineNumber = view.state.doc.lineAt(range.from).number;
    const info = inspectDebugLine(view, lineNumber);
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
}

export function getDebugSemanticInfo(view: EditorView): SemanticDebugInfo {
  return getDocumentAnalysisRevisionInfo(
    view.state.field(documentAnalysisField),
  );
}

export function getDebugSelectionInfo(view: EditorView): SelectionInfo {
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
}

export function getDebugStructureTarget(
  view: EditorView,
): StructureEditTarget | null {
  return getActiveStructureEditTarget(view.state);
}

function isElementVisibleInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

function lineNumberAtElement(view: EditorView, el: HTMLElement): number | null {
  try {
    return view.state.doc.lineAt(view.posAtDOM(el, 0)).number;
  } catch (_error) {
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

export function measureDebugRenderState(view: EditorView): DebugRenderState {
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

export function measureDebugGeometry(view: EditorView): ShellSurfaceSnapshot {
  return measureShellSurfaceSnapshot(view);
}

export function getDebugMotionGuards(
  view: EditorView,
): readonly VerticalMotionGuardEvent[] {
  return getVerticalMotionGuardEvents(view);
}

export function getDebugTimeline(
  view: EditorView,
): readonly DebugTimelineEvent[] {
  return getDebugTimelineEvents(view);
}

export function getDebugStructureSummary(view: EditorView): string {
  const target = getDebugStructureTarget(view);
  if (!target) return "none";
  if (target.kind === "frontmatter") return `frontmatter 0-${target.to}`;
  if (target.kind === "code-fence") {
    return `code-fence @ L${view.state.doc.lineAt(target.openFenceFrom).number}`;
  }
  if (target.kind === "fenced-opener") {
    return `${target.kind} @ L${view.state.doc.lineAt(target.openFenceFrom).number}`;
  }
  if (target.kind === "footnote-label") {
    return `footnote-label:${target.id} @ L${view.state.doc.lineAt(target.labelFrom).number}`;
  }
  return `${target.kind} @ L${view.state.doc.lineAt(target.from).number}`;
}

export function getDebugSnapshot(view: EditorView): DebugSnapshot {
  const cursor = view.state.selection.main;
  const cursorLine = view.state.doc.lineAt(cursor.from).number;
  return {
    divs: collectDebugTreeDivs(view),
    fences: collectDebugFenceStatuses(view),
    cursorLine,
    focused: view.hasFocus,
    semantics: getDebugSemanticInfo(view),
    structure: getDebugStructureTarget(view),
    geometry: measureDebugGeometry(view),
    render: measureDebugRenderState(view),
    motionGuards: getDebugMotionGuards(view),
    timeline: getDebugTimeline(view),
  };
}
