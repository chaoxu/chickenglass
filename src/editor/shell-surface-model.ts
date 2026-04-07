import type { EditorView } from "@codemirror/view";
import { frontmatterField } from "./frontmatter-state";
import {
  activeShellPath,
  isFrontmatterActive,
} from "./shell-ownership";

export interface ShellSurfaceRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface VisibleLineGeometry {
  readonly line: number;
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly classes: readonly string[];
  readonly rect: ShellSurfaceRect;
  readonly viewportTop: number;
  readonly viewportBottom: number;
  readonly documentTop: number;
  readonly documentBottom: number;
}

export interface ShellSurfaceNode {
  readonly kind: "line" | "widget";
  readonly from: number;
  readonly to: number;
  readonly line: number | null;
  readonly rect: ShellSurfaceRect;
}

export interface ShellSurface {
  readonly kind: "fenced" | "frontmatter" | "code";
  readonly key: string;
  readonly label: string;
  readonly depth: number;
  readonly from: number;
  readonly to: number;
  readonly rect: ShellSurfaceRect | null;
  readonly nodes: readonly ShellSurfaceNode[];
  readonly visibleTopLine: number | null;
  readonly visibleBottomLine: number | null;
}

export interface ShellSurfaceSnapshot {
  readonly measuredAt: number;
  readonly scrollTop: number;
  readonly viewportFromLine: number;
  readonly viewportToLine: number;
  readonly visibleLines: readonly VisibleLineGeometry[];
  readonly surfaces: readonly ShellSurface[];
}

export const shellSurfaceUpdateEvent = "cf-shell-surfaces-updated";

interface SourceRangeEntry {
  readonly kind: "line" | "widget";
  readonly from: number;
  readonly to: number;
  readonly line: number | null;
  readonly rect: ShellSurfaceRect;
}

const shellSurfaceSnapshots = new WeakMap<EditorView, ShellSurfaceSnapshot>();

function normalizeRect(
  left: number,
  right: number,
  top: number,
  bottom: number,
): ShellSurfaceRect | null {
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (height <= 0) return null;
  return { left, right, top, bottom, width, height };
}

function rectFromClientRect(
  rect: DOMRect | DOMRectReadOnly,
): ShellSurfaceRect | null {
  return normalizeRect(rect.left, rect.right, rect.top, rect.bottom);
}

function unionClientRects(
  rects: readonly (DOMRect | DOMRectReadOnly)[],
): ShellSurfaceRect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return normalizeRect(left, right, top, bottom);
}

function overlap(fromA: number, toA: number, fromB: number, toB: number): boolean {
  return fromA <= toB && fromB <= toA;
}

function parseSourcePos(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceRangeFromWidget(el: HTMLElement): { from: number; to: number } | null {
  const from = parseSourcePos(el.dataset.shellFrom);
  if (from === null) return null;
  const to = parseSourcePos(el.dataset.shellTo) ?? from;
  return { from, to };
}

function lineContentRect(node: HTMLElement): ShellSurfaceRect | null {
  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  if (rects.length > 0) {
    return unionClientRects(rects);
  }

  const nodeRect = node.getBoundingClientRect();
  if (nodeRect.height <= 0) return null;
  return normalizeRect(nodeRect.left, nodeRect.left, nodeRect.top, nodeRect.bottom);
}

function collectVisibleLineGeometry(
  view: EditorView,
): {
  readonly entries: readonly SourceRangeEntry[];
  readonly lines: readonly VisibleLineGeometry[];
} {
  const nodes = view.contentDOM.querySelectorAll<HTMLElement>(".cm-line");
  const entries: SourceRangeEntry[] = [];
  const lines: VisibleLineGeometry[] = [];
  const scrollRect = view.scrollDOM.getBoundingClientRect();
  const contentRect = view.contentDOM.getBoundingClientRect();
  const scrollTop = view.scrollDOM.scrollTop;
  for (const node of nodes) {
    let pos: number;
    try {
      pos = view.posAtDOM(node, 0);
    } catch {
      continue;
    }
    const line = view.state.doc.lineAt(pos);
    const rect = lineContentRect(node);
    if (!rect) continue;
    entries.push({
      kind: "line",
      from: line.from,
      to: line.to,
      line: line.number,
      rect,
    });
    lines.push({
      line: line.number,
      from: line.from,
      to: line.to,
      text: line.text,
      classes: Array.from(node.classList).filter((name) => name !== "cm-line"),
      rect,
      viewportTop: rect.top - scrollRect.top,
      viewportBottom: rect.bottom - scrollRect.top,
      documentTop: rect.top - contentRect.top + scrollTop,
      documentBottom: rect.bottom - contentRect.top + scrollTop,
    });
  }
  return { entries, lines };
}

function collectWidgetEntries(view: EditorView): SourceRangeEntry[] {
  const nodes = view.contentDOM.querySelectorAll<HTMLElement>("[data-shell-from]");
  const entries: SourceRangeEntry[] = [];
  for (const node of nodes) {
    const range = sourceRangeFromWidget(node);
    if (!range) continue;
    const rect = rectFromClientRect(node.getBoundingClientRect());
    if (!rect) continue;
    entries.push({
      kind: "widget",
      from: range.from,
      to: range.to,
      line: range.from <= view.state.doc.length ? view.state.doc.lineAt(range.from).number : null,
      rect,
    });
  }
  return entries;
}

function unionRects(rects: readonly ShellSurfaceRect[]): ShellSurfaceRect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return normalizeRect(left, right, top, bottom);
}

function buildSurface(
  kind: "fenced" | "frontmatter" | "code",
  key: string,
  label: string,
  depth: number,
  from: number,
  to: number,
  entries: readonly SourceRangeEntry[],
): ShellSurface {
  const nodes = entries
    .filter((entry) => overlap(entry.from, entry.to, from, to))
    .map((entry) => ({
      kind: entry.kind,
      from: entry.from,
      to: entry.to,
      line: entry.line,
      rect: entry.rect,
    }));
  const rect = unionRects(nodes.map((node) => node.rect));
  const lineNodes = nodes.filter((node) => node.line !== null);
  return {
    kind,
    key,
    label,
    depth,
    from,
    to,
    rect,
    nodes,
    visibleTopLine: lineNodes.length > 0 ? Math.min(...lineNodes.map((node) => node.line ?? Number.MAX_SAFE_INTEGER)) : null,
    visibleBottomLine: lineNodes.length > 0 ? Math.max(...lineNodes.map((node) => node.line ?? 0)) : null,
  };
}

export function measureShellSurfaceSnapshot(view: EditorView): ShellSurfaceSnapshot {
  const lineGeometry = collectVisibleLineGeometry(view);
  const entries = [
    ...lineGeometry.entries,
    ...collectWidgetEntries(view),
  ];
  const surfaces: ShellSurface[] = [];
  const state = view.state;

  if (isFrontmatterActive(state)) {
    const frontmatter = state.field(frontmatterField);
    surfaces.push(
      buildSurface(
        "frontmatter",
        "frontmatter",
        "frontmatter",
        0,
        0,
        frontmatter.end,
        entries,
      ),
    );
  } else {
    for (const shell of activeShellPath(state)) {
      if (shell.kind === "code") {
        const label = shell.block.language
          ? `code:${shell.block.language}`
          : "code";
        surfaces.push(
          buildSurface(
            "code",
            `code:${shell.block.openFenceFrom}`,
            label,
            shell.depth,
            shell.block.from,
            shell.block.to,
            entries,
          ),
        );
        continue;
      }
      surfaces.push(
        buildSurface(
          "fenced",
          `fenced:${shell.block.openFenceFrom}`,
          shell.block.className,
          shell.depth,
          shell.block.from,
          shell.block.to,
          entries,
        ),
      );
    }
  }

  return {
    measuredAt: Date.now(),
    scrollTop: Math.round(view.scrollDOM.scrollTop),
    viewportFromLine: view.state.doc.lineAt(view.viewport.from).number,
    viewportToLine: view.state.doc.lineAt(view.viewport.to).number,
    visibleLines: lineGeometry.lines,
    surfaces,
  };
}

export function getShellSurfaceSnapshot(view: EditorView): ShellSurfaceSnapshot | null {
  return shellSurfaceSnapshots.get(view) ?? null;
}

export function setShellSurfaceSnapshot(
  view: EditorView,
  snapshot: ShellSurfaceSnapshot,
): void {
  shellSurfaceSnapshots.set(view, snapshot);
}
