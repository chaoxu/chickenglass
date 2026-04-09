import { Transaction, type Extension, type Text } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { FencedDivInfo } from "../fenced-block/model";
import { frontmatterField } from "./frontmatter-state";
import { getActiveStructureEditTarget } from "./structure-edit-state";
import { getVerticalMotionGuardEvents } from "./vertical-motion";
import { getDebugSessionRecorderStatus } from "../debug/session-recorder";
import { activeShellPath, type CodeShellInfo } from "./shell-ownership";
import {
  getShellSurfaceSnapshot,
  shellSurfaceUpdateEvent,
} from "./shell-surface-model";
import {
  appendDebugTimelineEvent,
  clearDebugTimelineEvents,
  getDebugTimelineEvents,
} from "./debug-timeline";

const MAX_DOC_INSERT_PREVIEW_CHARS = 120;
const MIN_SCROLL_LOG_DELTA_PX = 48;
const MIN_SCROLL_LOG_INTERVAL_MS = 120;

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function currentLineClasses(view: EditorView): string[] {
  try {
    const pos = view.state.selection.main.head;
    const domPos = view.domAtPos(pos);
    let node: Node | null = domPos.node;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    while (node && !(node instanceof HTMLElement && node.classList.contains("cm-line"))) {
      node = node.parentNode;
    }
    if (!(node instanceof HTMLElement)) return [];
    return Array.from(node.classList).filter((name) => name.startsWith("cf-"));
  } catch {
    // Debug-only inspector: DOM lookups can race CM6 redraws or lightweight tests.
    return [];
  }
}

function caretDetail(view: EditorView, pos: number): {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
} | null {
  let coords: ReturnType<EditorView["coordsAtPos"]>;
  try {
    coords = view.coordsAtPos(pos, view.state.selection.main.assoc || 1);
  } catch {
    // Debug-only inspector: caret geometry is optional when layout APIs are unavailable.
    return null;
  }
  if (!coords) return null;
  return {
    left: coords.left,
    right: coords.right,
    top: coords.top,
    bottom: coords.bottom,
  };
}

function safePosAtDOM(
  view: EditorView,
  node: Node,
  offset: number,
): number | null {
  try {
    return view.posAtDOM(node, offset);
  } catch {
    // Debug-only inspector: stale DOM nodes are acceptable and should read as "unknown".
    return null;
  }
}

function lineBoundaryInfo(
  view: EditorView,
  target: EventTarget | null,
): {
  readonly lineFromPos: number | null;
  readonly lineFromLine: number | null;
  readonly lineToPos: number | null;
  readonly lineToLine: number | null;
} {
  const line = target instanceof HTMLElement
    ? target.closest<HTMLElement>(".cm-line")
    : null;
  if (!line) {
    return {
      lineFromPos: null,
      lineFromLine: null,
      lineToPos: null,
      lineToLine: null,
    };
  }

  const lineFromPos = safePosAtDOM(view, line, 0);
  const lineToPos = safePosAtDOM(view, line, line.childNodes.length) ?? lineFromPos;
  return {
    lineFromPos,
    lineFromLine: lineFromPos === null ? null : view.state.doc.lineAt(lineFromPos).number,
    lineToPos,
    lineToLine: lineToPos === null ? null : view.state.doc.lineAt(lineToPos).number,
  };
}

function domCaretPosAtPoint(
  view: EditorView,
  x: number,
  y: number,
): { readonly pos: number | null; readonly line: number | null } {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { readonly offsetNode: Node; readonly offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  const caretPosition = doc.caretPositionFromPoint?.(x, y);
  if (caretPosition && view.contentDOM.contains(caretPosition.offsetNode)) {
    const pos = safePosAtDOM(view, caretPosition.offsetNode, caretPosition.offset);
    return {
      pos,
      line: pos === null ? null : view.state.doc.lineAt(pos).number,
    };
  }

  const caretRange = doc.caretRangeFromPoint?.(x, y);
  if (caretRange && view.contentDOM.contains(caretRange.startContainer)) {
    const pos = safePosAtDOM(view, caretRange.startContainer, caretRange.startOffset);
    return {
      pos,
      line: pos === null ? null : view.state.doc.lineAt(pos).number,
    };
  }

  return { pos: null, line: null };
}

function describeBlock(view: EditorView, div: FencedDivInfo): string {
  const startLine = view.state.doc.lineAt(div.from).number;
  const endLine = view.state.doc.lineAt(div.to).number;
  const bits = [`${div.className}`, `L${startLine}-${endLine}`];
  if (div.id) bits.push(`#${div.id}`);
  if (div.title) bits.push(`"${div.title}"`);
  return bits.join(" ");
}

function describeCodeBlock(view: EditorView, block: CodeShellInfo): string {
  const startLine = view.state.doc.lineAt(block.from).number;
  const endLine = view.state.doc.lineAt(block.to).number;
  return block.language
    ? `code:${block.language} L${startLine}-${endLine}`
    : `code L${startLine}-${endLine}`;
}

function activePathSummary(view: EditorView): string {
  const path = activeShellPath(view.state);
  if (path.length === 0) return "none";
  return path.map((entry) => {
    if (entry.kind === "code") {
      return entry.block.language ? `code:${entry.block.language}` : "code";
    }
    return entry.block.className;
  }).join(" > ");
}

function surfaceSummary(view: EditorView): string {
  const snapshot = getShellSurfaceSnapshot(view);
  if (!snapshot || snapshot.surfaces.length === 0) return "none";
  return snapshot.surfaces.map((surface) => {
    if (!surface.rect) {
      return `${surface.label} depth=${surface.depth + 1} rect=(none) nodes=${surface.nodes.length}`;
    }
    return `${surface.label} depth=${surface.depth + 1} rect=(${Math.round(surface.rect.left)},${Math.round(surface.rect.top)}) ${Math.round(surface.rect.width)}x${Math.round(surface.rect.height)} lines=${surface.visibleTopLine ?? "-"}-${surface.visibleBottomLine ?? "-"} nodes=${surface.nodes.length}`;
  }).join("\n");
}

function structureSummary(view: EditorView): string {
  const target = getActiveStructureEditTarget(view.state);
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

function renderPanel(view: EditorView): string {
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  const selectionSummary = sel.empty
    ? `caret=L${line.number}:${sel.head - line.from + 1}`
    : `range=L${view.state.doc.lineAt(sel.from).number}-${view.state.doc.lineAt(sel.to).number}`;
  const structure = getActiveStructureEditTarget(view.state);
  const path = activeShellPath(view.state);
  const frontmatter = view.state.field(frontmatterField);
  const lineClasses = currentLineClasses(view);
  const guards = getVerticalMotionGuardEvents(view).slice(-8);
  const timeline = getDebugTimelineEvents(view).slice(-14);
  const recorder = getDebugSessionRecorderStatus();
  const surfacesText = surfaceSummary(view);
  const pathText = path.length > 0
    ? path.map((entry, index) =>
      `${index + 1}. ${entry.kind === "code" ? describeCodeBlock(view, entry.block) : describeBlock(view, entry.block)}`
    ).join("\n")
    : "(no active shell)";
  const guardText = guards.length > 0
    ? guards.map((event) => {
      if (event.kind === "visible-line-jump") {
        return `${event.kind}: L${event.beforeLine} -> raw L${event.rawTargetLine} -> fixed L${event.correctedTargetLine}`;
      }
      return `${event.kind}: L${event.beforeLine} -> L${event.afterLine}, scroll ${Math.round(event.beforeScrollTop)} -> ${Math.round(event.afterScrollTop)} -> ${Math.round(event.correctedScrollTop)}`;
    }).join("\n")
    : "clean";
  const structureText = structure ? JSON.stringify(structure, null, 2) : "null";
  const frontmatterText = frontmatter.end > 0
    ? `title=${frontmatter.config.title ?? "(none)"}\nrange=0-${frontmatter.end}`
    : "none";
  const viewportFromLine = view.state.doc.lineAt(view.viewport.from).number;
  const viewportToLine = view.state.doc.lineAt(view.viewport.to).number;
  const sessionPath = recorder.sessionId
    ? `/tmp/coflat-debug/${recorder.sessionId}.jsonl`
    : "(none)";
  const runtimeText = `scrollTop=${Math.round(view.scrollDOM.scrollTop)}
viewport=L${viewportFromLine}-L${viewportToLine}
docLines=${view.state.doc.lines}
guards=${guards.length}
session=${recorder.sessionId ?? "(none)"}
kind=${recorder.sessionKind}
capture=${recorder.captureMode}
stream=${recorder.connected ? "connected" : "buffering"}
queued=${recorder.queued}
sink=${sessionPath}`;
  const timelineText = timeline.length > 0
    ? timeline.map((event) => {
      const time = new Date(event.timestamp).toLocaleTimeString([], {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      return `${time} ${event.type} ${event.summary}`;
    }).join("\n")
    : "no events yet";
  const lineText = escapeHtml(line.text || "(blank)");
  const classesText = lineClasses.length > 0 ? lineClasses.join(" ") : "(none)";

  return `
    <div class="cf-debug-panel-title">Debug</div>
    <div class="cf-debug-panel-actions">
      <button class="cf-debug-panel-button" data-action="copy-timeline" type="button">Copy Timeline</button>
      <button class="cf-debug-panel-button" data-action="clear-timeline" type="button">Clear</button>
    </div>
    <section class="cf-debug-panel-section">
      <div class="cf-debug-panel-label">Caret / Range</div>
      <pre class="cf-debug-panel-pre">${selectionSummary}
line=${line.number} col=${sel.head - line.from + 1}
head=${sel.head} anchor=${sel.anchor}
from=${sel.from} to=${sel.to}
focused=${String(view.hasFocus)}</pre>
    </section>
    <section class="cf-debug-panel-section">
      <div class="cf-debug-panel-label">Current Line</div>
      <pre class="cf-debug-panel-pre">${lineText}</pre>
      <div class="cf-debug-panel-meta">${escapeHtml(classesText)}</div>
    </section>
    <section class="cf-debug-panel-section">
      <div class="cf-debug-panel-label">Active Path</div>
      <pre class="cf-debug-panel-pre">${escapeHtml(pathText)}</pre>
    </section>
    <section class="cf-debug-panel-section">
      <div class="cf-debug-panel-label">Structure Target</div>
      <pre class="cf-debug-panel-pre">${escapeHtml(structureText)}</pre>
    </section>
    <section class="cf-debug-panel-section">
      <div class="cf-debug-panel-label">Frontmatter</div>
      <pre class="cf-debug-panel-pre">${escapeHtml(frontmatterText)}</pre>
    </section>
    <section class="cf-debug-panel-section">
      <div class="cf-debug-panel-label">Measured Surfaces</div>
      <pre class="cf-debug-panel-pre">${escapeHtml(surfacesText)}</pre>
    </section>
    <section class="cf-debug-panel-section">
      <div class="cf-debug-panel-label">Runtime</div>
      <pre class="cf-debug-panel-pre">${escapeHtml(runtimeText)}</pre>
    </section>
    <section class="cf-debug-panel-section">
      <div class="cf-debug-panel-label">Motion Guards (${guards.length})</div>
      <pre class="cf-debug-panel-pre">${escapeHtml(guardText)}</pre>
    </section>
    <section class="cf-debug-panel-section">
      <div class="cf-debug-panel-label">Timeline (${timeline.length})</div>
      <pre class="cf-debug-panel-pre">${escapeHtml(timelineText)}</pre>
    </section>
  `;
}

function summarizeInsertedText(inserted: Text): {
  readonly insertedLength: number;
  readonly insertedPreview: string;
} {
  const insertedLength = inserted.length;
  return {
    insertedLength,
    insertedPreview: insertedLength === 0
      ? ""
      : inserted.sliceString(
        0,
        Math.min(insertedLength, MAX_DOC_INSERT_PREVIEW_CHARS),
      ),
  };
}

class DebugPanelView {
  readonly dom: HTMLElement;
  private view: EditorView;
  private readonly host: HTMLElement;
  private readonly handleScroll: () => void;
  private readonly handleKeyDown: (event: KeyboardEvent) => void;
  private readonly handlePointerDown: (event: PointerEvent) => void;
  private readonly handleClick: (event: MouseEvent) => void;
  private readonly handleSurfaceUpdate: () => void;
  private lastScrollTop: number;
  private lastScrollEventTop: number;
  private lastScrollEventAt: number;
  private lastSelectionHead: number;
  private lastFocus: boolean;
  private lastStructureSummary: string;
  private renderFrame: number | null;

  constructor(view: EditorView) {
    this.view = view;
    this.host = view.dom.parentElement ?? document.body;
    this.dom = document.createElement("aside");
    this.dom.className = "cf-debug-panel";
    this.dom.setAttribute("aria-hidden", "true");
    this.host.classList.add("cf-editor-debug-host");
    this.lastScrollTop = Math.round(view.scrollDOM.scrollTop);
    this.lastScrollEventTop = this.lastScrollTop;
    this.lastScrollEventAt = 0;
    this.lastSelectionHead = view.state.selection.main.head;
    this.lastFocus = view.hasFocus;
    this.lastStructureSummary = structureSummary(view);
    this.renderFrame = null;
    this.handleScroll = () => {
      const nextScrollTop = Math.round(this.view.scrollDOM.scrollTop);
      if (nextScrollTop !== this.lastScrollTop) {
        this.lastScrollTop = nextScrollTop;
        const now = Date.now();
        if (
          Math.abs(nextScrollTop - this.lastScrollEventTop) >= MIN_SCROLL_LOG_DELTA_PX ||
          now - this.lastScrollEventAt >= MIN_SCROLL_LOG_INTERVAL_MS
        ) {
          this.lastScrollEventTop = nextScrollTop;
          this.lastScrollEventAt = now;
          appendDebugTimelineEvent(this.view, {
            timestamp: now,
            type: "scroll",
            summary: `scrollTop=${nextScrollTop}`,
            detail: {
              scrollTop: nextScrollTop,
            },
          });
        }
      }
      this.requestRender();
    };
    this.handleKeyDown = (event) => {
      appendDebugTimelineEvent(this.view, {
        timestamp: Date.now(),
        type: "key",
        summary: `${event.key}${event.metaKey ? " meta" : ""}${event.ctrlKey ? " ctrl" : ""}${event.altKey ? " alt" : ""}${event.shiftKey ? " shift" : ""}`,
        detail: {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          line: this.view.state.doc.lineAt(this.view.state.selection.main.head).number,
          head: this.view.state.selection.main.head,
        },
      });
      this.requestRender();
    };
    this.handlePointerDown = (event) => {
      const coords = {
        x: event.clientX,
        y: event.clientY,
      };
      const precisePos = this.view.posAtCoords(coords);
      const imprecisePos = this.view.posAtCoords(coords, false);
      const line = precisePos === null ? null : this.view.state.doc.lineAt(precisePos).number;
      const contentRect = this.view.contentDOM.getBoundingClientRect();
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const lineBoundary = lineBoundaryInfo(this.view, event.target);
      const domCaret = domCaretPosAtPoint(this.view, event.clientX, event.clientY);
      appendDebugTimelineEvent(this.view, {
        timestamp: Date.now(),
        type: "pointer",
        summary: `pointer ${event.button} @ ${line === null ? "none" : `L${line}`}`,
        detail: {
          button: event.button,
          clientX: event.clientX,
          clientY: event.clientY,
          editorX: event.clientX - contentRect.left,
          editorY: event.clientY - contentRect.top,
          precisePos,
          preciseLine: precisePos === null ? null : this.view.state.doc.lineAt(precisePos).number,
          imprecisePos,
          impreciseLine: imprecisePos === null ? null : this.view.state.doc.lineAt(imprecisePos).number,
          domCaretPos: domCaret.pos,
          domCaretLine: domCaret.line,
          lineFromPos: lineBoundary.lineFromPos,
          lineFromLine: lineBoundary.lineFromLine,
          lineToPos: lineBoundary.lineToPos,
          lineToLine: lineBoundary.lineToLine,
          line,
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          hitTag: hit?.tagName ?? null,
          hitClass: hit instanceof HTMLElement ? hit.className : null,
          hitText: hit?.textContent?.slice(0, 120) ?? null,
        },
      });
    };
    this.handleClick = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action;
      if (action === "clear-timeline") {
        clearDebugTimelineEvents(this.view);
        this.requestRender();
        return;
      }
      if (action === "copy-timeline") {
        const payload = JSON.stringify(getDebugTimelineEvents(this.view), null, 2);
        void navigator.clipboard.writeText(payload);
      }
    };
    this.handleSurfaceUpdate = () => {
      this.requestRender();
    };
    this.host.appendChild(this.dom);
    view.scrollDOM.addEventListener("scroll", this.handleScroll, { passive: true });
    view.contentDOM.addEventListener("keydown", this.handleKeyDown, true);
    view.contentDOM.addEventListener("pointerdown", this.handlePointerDown, true);
    this.dom.addEventListener("click", this.handleClick);
    view.dom.addEventListener(shellSurfaceUpdateEvent, this.handleSurfaceUpdate);
    appendDebugTimelineEvent(view, {
      timestamp: Date.now(),
      type: "focus",
      summary: "debug lane mounted",
    });
    this.requestRender();
  }

  update(update: ViewUpdate): void {
    this.view = update.view;
    const nextSelectionHead = update.state.selection.main.head;
    if (update.selectionSet && nextSelectionHead !== this.lastSelectionHead) {
      const selection = update.state.selection.main;
      const line = update.state.doc.lineAt(nextSelectionHead).number;
      const rangeFromLine = update.state.doc.lineAt(selection.from).number;
      const rangeToLine = update.state.doc.lineAt(selection.to).number;
      appendDebugTimelineEvent(update.view, {
        timestamp: Date.now(),
        type: selection.empty ? "caret" : "range",
        summary: selection.empty
          ? `caret L${line} head=${nextSelectionHead}`
          : `range L${rangeFromLine}-${rangeToLine} head=${nextSelectionHead} anchor=${selection.anchor}`,
        detail: {
          head: nextSelectionHead,
          line,
          anchor: selection.anchor,
          from: selection.from,
          to: selection.to,
          empty: selection.empty,
          rangeFromLine,
          rangeToLine,
          structure: structureSummary(update.view),
          path: activePathSummary(update.view),
          caret: caretDetail(update.view, nextSelectionHead),
        },
      });
      this.lastSelectionHead = nextSelectionHead;
    }
    if (update.docChanged) {
      for (const tr of update.transactions) {
        if (!tr.docChanged) continue;
        const userEvent = tr.annotation(Transaction.userEvent) ?? "doc";
        const line = update.state.doc.lineAt(update.state.selection.main.head).number;
        appendDebugTimelineEvent(update.view, {
          timestamp: Date.now(),
          type: "doc",
          summary: `${userEvent} -> L${line}`,
          detail: {
            userEvent,
            line,
            head: update.state.selection.main.head,
            anchor: update.state.selection.main.anchor,
            structure: structureSummary(update.view),
            path: activePathSummary(update.view),
            newDocLength: update.state.doc.length,
            changes: (() => {
              const changes: Array<{
                fromA: number;
                toA: number;
                fromB: number;
                toB: number;
                insertedLength: number;
                insertedPreview: string;
              }> = [];
              tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
                changes.push({
                  fromA,
                  toA,
                  fromB,
                  toB,
                  ...summarizeInsertedText(inserted),
                });
              });
              return changes;
            })(),
          },
        });
      }
    }
    if (update.focusChanged && update.view.hasFocus !== this.lastFocus) {
      this.lastFocus = update.view.hasFocus;
      appendDebugTimelineEvent(update.view, {
        timestamp: Date.now(),
        type: "focus",
        summary: update.view.hasFocus ? "focus" : "blur",
        detail: {
          structure: structureSummary(update.view),
          path: activePathSummary(update.view),
        },
      });
    }
    const nextStructure = structureSummary(update.view);
    if (nextStructure !== this.lastStructureSummary) {
      this.lastStructureSummary = nextStructure;
      appendDebugTimelineEvent(update.view, {
        timestamp: Date.now(),
        type: "structure",
        summary: nextStructure,
        detail: getActiveStructureEditTarget(update.state),
      });
    }
    if (
      update.docChanged ||
      update.selectionSet ||
      update.focusChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      update.transactions.some((tr) => tr.effects.length > 0)
    ) {
      this.requestRender();
    }
  }

  destroy(): void {
    if (this.renderFrame !== null) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
    this.view.scrollDOM.removeEventListener("scroll", this.handleScroll);
    this.view.contentDOM.removeEventListener("keydown", this.handleKeyDown, true);
    this.view.contentDOM.removeEventListener("pointerdown", this.handlePointerDown, true);
    this.dom.removeEventListener("click", this.handleClick);
    this.view.dom.removeEventListener(shellSurfaceUpdateEvent, this.handleSurfaceUpdate);
    this.dom.remove();
    this.host.classList.remove("cf-editor-debug-host");
  }

  private requestRender(): void {
    if (this.renderFrame !== null) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.render(this.view);
    });
  }

  private render(view: EditorView): void {
    this.dom.innerHTML = renderPanel(view);
  }
}

export const debugPanelExtension: Extension = ViewPlugin.fromClass(DebugPanelView);
