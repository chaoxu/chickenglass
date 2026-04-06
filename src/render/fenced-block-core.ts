import { type EditorState, type Line, type Range, type StateField, type Transaction } from "@codemirror/state";
import { type DecorationSet, Decoration, EditorView } from "@codemirror/view";
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { FencedBlockInfo } from "../fenced-block/model";
import {
  buildDecorations,
  createDecorationsField,
  decorationHidden,
  editorFocusField,
  focusEffect,
} from "./render-utils";
import { CSS } from "../constants/css-classes";

export { findFencedBlockAt, type FencedBlockInfo } from "../fenced-block/model";

/** Shared derived state for rendering a fenced block. */
export interface FencedBlockRenderContext<T extends FencedBlockInfo> {
  readonly state: EditorState;
  readonly block: T;
  readonly focused: boolean;
  readonly cursorOnOpenFence: boolean;
  readonly cursorOnCloseFence: boolean;
  readonly cursorOnEitherFence: boolean;
  readonly openLine: Line;
  readonly closeLine: Line;
  readonly bodyLineCount: number;
}

/** Check whether the cursor is on the opening fence line of a fenced block. */
export function isCursorOnOpenFence(
  state: EditorState,
  block: FencedBlockInfo,
  focused: boolean,
): boolean {
  if (!focused) return false;
  const cursor = state.selection.main;
  const openLine = state.doc.lineAt(block.openFenceFrom);
  return cursor.from >= openLine.from && cursor.from <= openLine.to;
}

/** Check whether the cursor is on the closing fence line of a fenced block. */
export function isCursorOnCloseFence(
  state: EditorState,
  block: FencedBlockInfo,
  focused: boolean,
): boolean {
  if (!focused || block.closeFenceFrom < 0) return false;
  const cursor = state.selection.main;
  return cursor.from >= block.closeFenceFrom && cursor.from <= block.closeFenceTo;
}

/** Compute shared fence/body render context for a fenced block. */
export function getFencedBlockRenderContext<T extends FencedBlockInfo>(
  state: EditorState,
  block: T,
  focused: boolean,
): FencedBlockRenderContext<T> {
  const cursorOnOpenFence = isCursorOnOpenFence(state, block, focused);
  const cursorOnCloseFence = isCursorOnCloseFence(state, block, focused);
  const openLine = state.doc.lineAt(block.openFenceFrom);
  const closeLine = block.closeFenceFrom >= 0 && block.closeFenceFrom <= state.doc.length
    ? state.doc.lineAt(block.closeFenceFrom)
    : openLine;
  return {
    state,
    block,
    focused,
    cursorOnOpenFence,
    cursorOnCloseFence,
    cursorOnEitherFence: cursorOnOpenFence || cursorOnCloseFence,
    openLine,
    closeLine,
    bodyLineCount: Math.max(0, closeLine.number - openLine.number - 1),
  };
}

/** Resolve the rendered CM line element containing a document position. */
export function getLineElement(view: EditorView, pos: number): HTMLElement | null {
  const domPos = view.domAtPos(pos);
  let el: Node | null = domPos.node;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentNode;
  while (el && !(el instanceof HTMLElement && el.classList.contains("cm-line"))) {
    el = el.parentNode;
  }
  return el as HTMLElement | null;
}

/** Hide a trailing closing fence that lives on the same line as the opening fence. */
export function addSingleLineClosingFence(
  state: EditorState,
  closeFenceFrom: number,
  closeFenceTo: number,
  items: Range<Decoration>[],
): void {
  if (closeFenceFrom < 0 || closeFenceTo <= closeFenceFrom) return;

  let hideFrom = closeFenceFrom;
  const line = state.doc.lineAt(closeFenceFrom);
  const relPos = hideFrom - line.from;
  let trimFrom = relPos;
  while (
    trimFrom > 0 &&
    (line.text.charCodeAt(trimFrom - 1) === 32 ||
      line.text.charCodeAt(trimFrom - 1) === 9)
  ) {
    trimFrom--;
  }
  hideFrom = line.from + trimFrom;
  items.push(decorationHidden.range(hideFrom, closeFenceTo));
}

/** Hide a multi-line closing fence (hidden text + zero-height line class). */
export function hideMultiLineClosingFence(
  closeFenceFrom: number,
  closeFenceTo: number,
  items: Range<Decoration>[],
): void {
  if (closeFenceFrom < 0 || closeFenceTo <= closeFenceFrom) return;

  items.push(decorationHidden.range(closeFenceFrom, closeFenceTo));
  items.push(
    Decoration.line({ class: CSS.blockClosingFence }).range(closeFenceFrom),
  );
}

/** Hide a multi-line closing fence and collapse its line. */
export function addCollapsedClosingFence(
  closeFenceFrom: number,
  closeFenceTo: number,
  items: Range<Decoration>[],
): void {
  if (closeFenceFrom < 0 || closeFenceTo <= closeFenceFrom) return;

  items.push(decorationHidden.range(closeFenceFrom, closeFenceTo));
  items.push(
    Decoration.line({ class: CSS.includeFence }).range(closeFenceFrom),
  );
}

/** Shared DecorationSet builder for fenced-block renderers. */
export function buildFencedBlockDecorations<T extends FencedBlockInfo>(
  state: EditorState,
  collect: (state: EditorState) => readonly T[],
  decorate: (
    context: FencedBlockRenderContext<T>,
    items: Range<Decoration>[],
  ) => void,
): DecorationSet {
  const focused = state.field(editorFocusField, false) ?? false;
  const items: Range<Decoration>[] = [];
  for (const block of collect(state)) {
    decorate(getFencedBlockRenderContext(state, block, focused), items);
  }
  return buildDecorations(items);
}

/**
 * Cursor-sensitive rebuild predicate excluding docChanged.
 *
 * Used with `mapOnDocChanged: true` so that text edits preserving the
 * syntax tree map decoration positions instead of rebuilding (#718).
 */
function cursorSensitiveMappedRebuild(tr: Transaction): boolean {
  return (
    tr.selection !== undefined ||
    tr.effects.some((e) => e.is(focusEffect)) ||
    (syntaxTree(tr.state) !== syntaxTree(tr.startState) &&
      syntaxTreeAvailable(tr.state, tr.state.doc.length))
  );
}

/** Shared StateField wrapper for fenced-block renderers.
 * Uses cursor-sensitive rebuild because fenced blocks show/hide fences
 * based on cursor proximity.
 * Uses `mapOnDocChanged` so text edits preserving the syntax tree
 * map decoration positions for cheaper DOM reconciliation (#718). */
export function createFencedBlockDecorationField(
  build: (state: EditorState) => DecorationSet,
): StateField<DecorationSet> {
  return createDecorationsField(build, cursorSensitiveMappedRebuild, true);
}
