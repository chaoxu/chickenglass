/**
 * CM6 decoration provider for fenced code blocks (```lang ... ```).
 *
 * For each FencedCode node in the syntax tree:
 * - When cursor is outside the fence lines: replace the opening fence with a
 *   header widget, hide the closing fence line, and style the block body.
 * - When cursor is on the opening fence line: show the opening fence as source,
 *   keep body rendered.
 * - The closing ``` is ALWAYS hidden (zero height), protected from accidental
 *   deletion by a transaction filter, and skipped by atomicRanges (#429).
 *
 * Closing fence protection and atomic ranges are provided by the unified
 * fenceProtectionExtension in fence-protection.ts (#441).
 *
 * Uses a StateField (not ViewPlugin) so that Decoration.line is permitted
 * by CM6.
 */

import {
  type DecorationSet,
  Decoration,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  EditorState,
  type Extension,
  type Range,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import {
  RenderWidget,
  editorFocusField,
  focusEffect,
  focusTracker,
  pushWidgetDecoration,
  SimpleTextRenderWidget,
} from "./render-utils";
import {
  buildFencedBlockDecorations,
  findFencedBlockAt,
  type FencedBlockInfo,
  type FencedBlockRenderContext,
  getFencedBlockRenderContext,
  getLineElement,
  hideMultiLineClosingFence,
  isCursorOnCloseFence,
  isCursorOnOpenFence,
} from "./fenced-block-core";
import { CSS } from "../constants/css-classes";
import { __iconNode as copyIconNode } from "lucide-react/dist/esm/icons/copy.js";
import { __iconNode as checkIconNode } from "lucide-react/dist/esm/icons/check.js";
import { COPY_RESET_MS } from "../constants";

type IconNode = ReadonlyArray<readonly [string, Readonly<Record<string, string>>]>;

function createLucideIcon(iconNode: IconNode): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("xmlns", ns);
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("lucide");

  for (const [tag, attrs] of iconNode) {
    const child = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (name === "key") continue;
      child.setAttribute(name, value);
    }
    svg.appendChild(child);
  }

  return svg;
}

/** Widget that renders a copy-to-clipboard button in the code block header. */
class CopyButtonWidget extends RenderWidget {
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private buttonEl: HTMLButtonElement | null = null;

  constructor(private readonly code: string) {
    super();
  }

  private clearResetTimer(): void {
    const timer = this.resetTimer;
    this.resetTimer = null;
    if (timer !== null) clearTimeout(timer);
  }

  private getLiveButton(expected: HTMLButtonElement): HTMLButtonElement | null {
    const button = this.buttonEl;
    if (!button || button !== expected || !button.isConnected) return null;
    return button;
  }

  toDOM(): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "cf-codeblock-copy";
    btn.type = "button";
    btn.setAttribute("aria-label", "Copy code to clipboard");
    btn.appendChild(createLucideIcon(copyIconNode));
    this.buttonEl = btn;
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void navigator.clipboard.writeText(this.code).then(() => {
        const button = this.getLiveButton(btn);
        if (!button) return;
        button.replaceChildren(createLucideIcon(checkIconNode));
        button.setAttribute("aria-label", "Copied");
        this.clearResetTimer();
        this.resetTimer = setTimeout(() => {
          this.resetTimer = null;
          const liveButton = this.getLiveButton(btn);
          if (!liveButton) return;
          liveButton.replaceChildren(createLucideIcon(copyIconNode));
          liveButton.setAttribute("aria-label", "Copy code to clipboard");
        }, COPY_RESET_MS);
      }).catch((e: unknown) => {
        console.error("[code-block] clipboard write failed", e);
      });
    });
    return btn;
  }

  destroy(): void {
    this.clearResetTimer();
    this.buttonEl = null;
  }

  eq(other: CopyButtonWidget): boolean {
    return this.code === other.code;
  }
}

export interface CodeBlockInfo extends FencedBlockInfo {
  /** Start of the FencedCode node (opening fence line start). */
  readonly from: number;
  /** End of the FencedCode node (closing fence line end). */
  readonly to: number;
  /** Language identifier (empty string if none). */
  readonly language: string;
  /** Opening fence marker run (` ``` ` or `~~~`). */
  readonly openFenceMarker: string;
}

interface CodeBlockStructureCache {
  readonly blocks: readonly CodeBlockInfo[];
  readonly structureRevision: number;
}

interface DirtyRange {
  readonly from: number;
  readonly to: number;
}

function createCodeBlockInfo(
  state: EditorState,
  nodeFrom: number,
  nodeTo: number,
  language: string,
): CodeBlockInfo {
  const openLine = state.doc.lineAt(nodeFrom);
  const closeLine = state.doc.lineAt(nodeTo);
  const openFenceText = state.doc.sliceString(openLine.from, openLine.to);
  const openFenceMarker = /^([`~]{3,})/.exec(openFenceText)?.[1] ?? "";

  return {
    from: nodeFrom,
    to: nodeTo,
    openFenceFrom: openLine.from,
    openFenceTo: openLine.to,
    closeFenceFrom: closeLine.from,
    closeFenceTo: closeLine.to,
    singleLine: closeLine.from === openLine.from,
    language,
    openFenceMarker,
  };
}

/** Extract info about FencedCode nodes from the syntax tree. */
function scanCodeBlocks(
  state: EditorState,
  ranges?: readonly DirtyRange[],
): readonly CodeBlockInfo[] {
  const results: CodeBlockInfo[] = [];
  const seen = new Set<number>();
  const tree = syntaxTree(state);

  const collectInRange = (from?: number, to?: number) => {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.type.name !== "FencedCode" || seen.has(node.from)) return;
        seen.add(node.from);

        let language = "";
        const codeInfoNode = node.node.getChild("CodeInfo");
        if (codeInfoNode) {
          language = state.doc.sliceString(codeInfoNode.from, codeInfoNode.to).trim();
        }

        results.push(createCodeBlockInfo(state, node.from, node.to, language));
      },
    });
  };

  if (ranges) {
    for (const range of ranges) {
      collectInRange(range.from, range.to);
    }
    results.sort((left, right) => left.from - right.from);
    return results;
  }

  collectInRange();
  return results;
}

function rangesOverlap(
  leftFrom: number,
  leftTo: number,
  rightFrom: number,
  rightTo: number,
): boolean {
  return leftFrom <= rightTo && rightFrom <= leftTo;
}

function sameCodeBlockInfo(
  left: CodeBlockInfo,
  right: CodeBlockInfo,
): boolean {
  return left.from === right.from
    && left.to === right.to
    && left.openFenceFrom === right.openFenceFrom
    && left.openFenceTo === right.openFenceTo
    && left.closeFenceFrom === right.closeFenceFrom
    && left.closeFenceTo === right.closeFenceTo
    && left.singleLine === right.singleLine
    && left.language === right.language
    && left.openFenceMarker === right.openFenceMarker;
}

function sameCodeBlockLists(
  left: readonly CodeBlockInfo[],
  right: readonly CodeBlockInfo[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!sameCodeBlockInfo(left[index], right[index])) return false;
  }
  return true;
}

function mapCodeBlock(
  block: CodeBlockInfo,
  tr: Transaction,
): CodeBlockInfo {
  const from = tr.changes.mapPos(block.from, 1);
  const to = Math.max(from, tr.changes.mapPos(block.to, -1));
  const openFenceFrom = tr.changes.mapPos(block.openFenceFrom, 1);
  const openFenceTo = Math.max(openFenceFrom, tr.changes.mapPos(block.openFenceTo, -1));
  const closeFenceFrom = tr.changes.mapPos(block.closeFenceFrom, 1);
  const closeFenceTo = Math.max(closeFenceFrom, tr.changes.mapPos(block.closeFenceTo, -1));
  const singleLine = closeFenceFrom === openFenceFrom;

  if (
    from === block.from
    && to === block.to
    && openFenceFrom === block.openFenceFrom
    && openFenceTo === block.openFenceTo
    && closeFenceFrom === block.closeFenceFrom
    && closeFenceTo === block.closeFenceTo
    && singleLine === block.singleLine
  ) {
    return block;
  }

  return {
    ...block,
    from,
    to,
    openFenceFrom,
    openFenceTo,
    closeFenceFrom,
    closeFenceTo,
    singleLine,
  };
}

function mapCodeBlocks(
  blocks: readonly CodeBlockInfo[],
  tr: Transaction,
): readonly CodeBlockInfo[] {
  let changed = false;
  const mapped = blocks.map((block) => {
    const next = mapCodeBlock(block, tr);
    if (next !== block) changed = true;
    return next;
  });
  return changed ? mapped : blocks;
}

function mergeDirtyRanges(ranges: readonly DirtyRange[]): readonly DirtyRange[] {
  if (ranges.length <= 1) return ranges;

  const sorted = [...ranges].sort((left, right) => left.from - right.from);
  const merged: DirtyRange[] = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = merged[merged.length - 1];
    if (current.from <= previous.to + 1) {
      merged[merged.length - 1] = {
        from: previous.from,
        to: Math.max(previous.to, current.to),
      };
      continue;
    }
    merged.push(current);
  }

  return merged;
}

function touchesCodeBlockFence(
  from: number,
  to: number,
  block: Pick<CodeBlockInfo, "openFenceFrom" | "openFenceTo" | "closeFenceFrom" | "closeFenceTo" | "singleLine">,
): boolean {
  if (rangesOverlap(from, to, block.openFenceFrom, block.openFenceTo)) return true;
  if (block.singleLine) return false;
  return rangesOverlap(from, to, block.closeFenceFrom, block.closeFenceTo);
}

function computeCodeBlockStructureDirtyRanges(
  blocks: readonly CodeBlockInfo[],
  tr: Transaction,
): readonly DirtyRange[] {
  const dirtyRanges: DirtyRange[] = [];

  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    let dirtyFrom = Number.POSITIVE_INFINITY;
    let dirtyTo = Number.NEGATIVE_INFINITY;

    for (const block of blocks) {
      if (block.from > toA) break;
      if (!touchesCodeBlockFence(fromA, toA, block)) continue;
      dirtyFrom = Math.min(dirtyFrom, tr.changes.mapPos(block.from, 1));
      dirtyTo = Math.max(dirtyTo, tr.changes.mapPos(block.to, -1));
    }

    const newBlocks = scanCodeBlocks(tr.state, [{ from: fromB, to: toB }]);
    for (const block of newBlocks) {
      if (!touchesCodeBlockFence(fromB, toB, block)) continue;
      dirtyFrom = Math.min(dirtyFrom, block.from);
      dirtyTo = Math.max(dirtyTo, block.to);
    }

    if (dirtyFrom <= dirtyTo) {
      dirtyRanges.push({ from: dirtyFrom, to: dirtyTo });
    }
  });

  return mergeDirtyRanges(dirtyRanges);
}

function codeBlockOverlapsDirtyRanges(
  block: CodeBlockInfo,
  dirtyRanges: readonly DirtyRange[],
): boolean {
  for (const range of dirtyRanges) {
    if (range.to < block.from) continue;
    if (range.from > block.to) break;
    if (rangesOverlap(block.from, block.to, range.from, range.to)) return true;
  }
  return false;
}

function buildCodeBlockStructureCache(
  blocks: readonly CodeBlockInfo[],
  structureRevision = 0,
): CodeBlockStructureCache {
  return { blocks, structureRevision };
}

function incrementalCodeBlockStructureUpdate(
  value: CodeBlockStructureCache,
  tr: Transaction,
): CodeBlockStructureCache {
  const mappedBlocks = mapCodeBlocks(value.blocks, tr);
  const dirtyRanges = computeCodeBlockStructureDirtyRanges(value.blocks, tr);
  if (dirtyRanges.length === 0) {
    return mappedBlocks === value.blocks
      ? value
      : buildCodeBlockStructureCache(mappedBlocks, value.structureRevision);
  }

  const rebuiltBlocks = scanCodeBlocks(tr.state, dirtyRanges);
  const preservedBlocks: CodeBlockInfo[] = [];
  for (const block of mappedBlocks) {
    if (codeBlockOverlapsDirtyRanges(block, dirtyRanges)) continue;
    preservedBlocks.push(block);
  }

  const nextBlocks = [...preservedBlocks, ...rebuiltBlocks].sort((left, right) => left.from - right.from);
  if (sameCodeBlockLists(nextBlocks, mappedBlocks)) {
    return buildCodeBlockStructureCache(mappedBlocks, value.structureRevision);
  }

  return buildCodeBlockStructureCache(nextBlocks, value.structureRevision + 1);
}

function getCodeBlockStructureCache(
  state: EditorState,
): CodeBlockStructureCache | null {
  return state.field(codeBlockStructureField, false) ?? null;
}

/**
 * Shared code-block structure cache for the current document/tree.
 *
 * Rich-mode consumers should read this field via collectCodeBlocks() instead
 * of rewalking the full syntax tree on cursor, hover, or handler-only updates.
 */
export const codeBlockStructureField = StateField.define<CodeBlockStructureCache>({
  create(state) {
    return buildCodeBlockStructureCache(scanCodeBlocks(state));
  },

  update(value, tr) {
    if (tr.docChanged) {
      if (!syntaxTreeAvailable(tr.state, tr.state.doc.length)) {
        const mappedBlocks = mapCodeBlocks(value.blocks, tr);
        const blocks = scanCodeBlocks(tr.state);
        if (sameCodeBlockLists(blocks, mappedBlocks)) {
          return buildCodeBlockStructureCache(mappedBlocks, value.structureRevision);
        }
        return buildCodeBlockStructureCache(blocks, value.structureRevision + 1);
      }
      return incrementalCodeBlockStructureUpdate(value, tr);
    }
    if (
      syntaxTree(tr.state) !== syntaxTree(tr.startState) &&
      syntaxTreeAvailable(tr.state, tr.state.doc.length)
    ) {
      const blocks = scanCodeBlocks(tr.state);
      if (sameCodeBlockLists(blocks, value.blocks)) return value;
      return buildCodeBlockStructureCache(blocks, value.structureRevision + 1);
    }
    return value;
  },
});

export function getCodeBlockStructureRevision(state: EditorState): number {
  return getCodeBlockStructureCache(state)?.structureRevision ?? 0;
}

/**
 * Return code-block structure from the shared cache when present, and fall back
 * to a one-off tree walk in isolated test states that don't install the field.
 */
export function collectCodeBlocks(state: EditorState): readonly CodeBlockInfo[] {
  return getCodeBlockStructureCache(state)?.blocks ?? scanCodeBlocks(state);
}

/** Decoration callback for a single code block. Shared by full and incremental paths. */
function decorateCodeBlock(
  context: FencedBlockRenderContext<CodeBlockInfo>,
  items: Range<Decoration>[],
): void {
  const { state, block, cursorOnEitherFence, openLine, closeLine, bodyLineCount } = context;

  // --- Opening fence ---
  if (cursorOnEitherFence) {
    items.push(
      Decoration.line({ class: CSS.codeblockSourceOpen })
        .range(block.openFenceFrom),
    );
  } else {
    items.push(
      Decoration.line({
        class: CSS.codeblockHeader,
      }).range(block.openFenceFrom),
    );
    const codeText = bodyLineCount > 0
      ? state.doc.sliceString(
        state.doc.line(openLine.number + 1).from,
        state.doc.line(closeLine.number - 1).to,
      )
      : "";
    pushWidgetDecoration(items, new SimpleTextRenderWidget({
      tagName: "span",
      className: CSS.codeblockLanguage,
      text: block.language,
    }), block.openFenceFrom, block.openFenceTo);
    if (bodyLineCount > 0) {
      items.push(
        Decoration.widget({
          widget: new CopyButtonWidget(codeText),
          side: 1,
        }).range(block.openFenceFrom),
      );
    }
  }

  // --- Body lines ---
  for (let ln = openLine.number + 1; ln < closeLine.number; ln++) {
    const line = state.doc.line(ln);
    const isLast = ln === closeLine.number - 1;
    items.push(
      Decoration.line({
        class: isLast ? CSS.codeblockLast : CSS.codeblockBody,
      }).range(line.from),
    );
  }

  if (bodyLineCount === 0 && !cursorOnEitherFence) {
    items.push(
      Decoration.line({ class: CSS.codeblockLast }).range(block.openFenceFrom),
    );
  }

  // --- Closing fence ---
  // Always hidden in rich mode regardless of cursor position (#429).
  // The closing fence is protected from accidental deletion by a
  // transaction filter and skipped by atomicRanges (see below).
  if (!block.singleLine) {
    hideMultiLineClosingFence(block.closeFenceFrom, block.closeFenceTo, items);
  }
}

/** Build decorations for all fenced code blocks. */
function buildCodeBlockDecorations(state: EditorState): DecorationSet {
  return buildFencedBlockDecorations(state, collectCodeBlocks, decorateCodeBlock);
}

// ── Incremental doc-change support ──────────────────────────────────────────

/**
 * Compute the dirty region in the new document that needs decoration rebuild.
 *
 * Expands the literal changed ranges to cover any FencedCode blocks that
 * overlap them in BOTH the old and new trees. This ensures that decorations
 * for destroyed blocks (present in old tree but absent in new) are removed,
 * and decorations for newly created blocks are added.
 */
function computeCodeBlockDirtyRegion(
  tr: Transaction,
): { filterFrom: number; filterTo: number } | null {
  let filterFrom = Number.POSITIVE_INFINITY;
  let filterTo = Number.NEGATIVE_INFINITY;

  const oldTree = syntaxTree(tr.startState);
  const newTree = syntaxTree(tr.state);

  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    // Start with the literal changed range in the new document
    filterFrom = Math.min(filterFrom, fromB);
    filterTo = Math.max(filterTo, toB);

    // Expand for blocks in the OLD tree (mapped to new positions)
    oldTree.iterate({
      from: fromA,
      to: toA,
      enter(node) {
        if (node.type.name === "FencedCode") {
          filterFrom = Math.min(filterFrom, tr.changes.mapPos(node.from));
          filterTo = Math.max(filterTo, tr.changes.mapPos(node.to));
          return false; // don't descend into children
        }
      },
    });

    // Expand for blocks in the NEW tree
    newTree.iterate({
      from: fromB,
      to: toB,
      enter(node) {
        if (node.type.name === "FencedCode") {
          filterFrom = Math.min(filterFrom, node.from);
          filterTo = Math.max(filterTo, node.to);
          return false;
        }
      },
    });
  });

  if (filterFrom > filterTo) return null;
  return { filterFrom, filterTo };
}

/** Build decoration items for code blocks overlapping a specific range. */
function buildCodeBlockItemsInRange(
  state: EditorState,
  rangeFrom: number,
  rangeTo: number,
): Range<Decoration>[] {
  const focused = state.field(editorFocusField, false) ?? false;
  const items: Range<Decoration>[] = [];
  for (const block of collectCodeBlocks(state)) {
    if (block.to < rangeFrom) continue;
    if (block.from > rangeTo) break;
    decorateCodeBlock(
      getFencedBlockRenderContext(state, block, focused),
      items,
    );
  }

  return items;
}

/**
 * Incremental doc-change update: map existing decorations through changes,
 * then filter and rebuild only the dirty region.
 */
function incrementalCodeBlockUpdate(
  value: DecorationSet,
  tr: Transaction,
): DecorationSet {
  const mapped = value.map(tr.changes);
  const dirty = computeCodeBlockDirtyRegion(tr);
  if (!dirty) return mapped;

  const { filterFrom, filterTo } = dirty;
  const newItems = buildCodeBlockItemsInRange(tr.state, filterFrom, filterTo);

  return mapped.update({
    filterFrom,
    filterTo,
    filter: () => false, // remove all mapped decorations in the dirty region
    add: newItems,
    sort: true,
  });
}

class CodeBlockHoverPlugin {
  private hoveredBlockOpenFence: number | null = null;
  private hoveredHeaderEl: HTMLElement | null = null;
  /**
   * Cached code-block list, rebuilt only when the state changes.
   * Avoids a full syntax-tree scan on every mousemove event.
   */
  private cachedBlocks: readonly CodeBlockInfo[] = [];
  private cachedBlocksState: EditorState | null = null;

  constructor(private readonly view: EditorView) {
    this.cachedBlocks = collectCodeBlocks(view.state);
    this.cachedBlocksState = view.state;
  }

  update(update: ViewUpdate): void {
    // Rebuild the block cache whenever something structural changes.
    if (update.docChanged || update.viewportChanged || update.focusChanged) {
      this.cachedBlocks = collectCodeBlocks(update.state);
      this.cachedBlocksState = update.state;
    }
    if (this.hoveredBlockOpenFence === null) return;
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
      this.refreshHoveredHeader();
    }
  }

  destroy(): void {
    this.clearHoveredHeader();
  }

  handleMouseMove(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) {
      this.clearHoveredHeader();
      return;
    }

    const lineEl = target.closest(".cm-line");
    if (!(lineEl instanceof HTMLElement)) {
      this.clearHoveredHeader();
      return;
    }

    // Fast path: if the hovered element is already a header, use it directly.
    // Only look up the block in the cached list (no tree scan on mousemove).
    let pos: number;
    try {
      pos = this.view.posAtDOM(lineEl, 0);
    } catch {
      // best-effort: DOM node may be detached after view update — clear hover state
      this.clearHoveredHeader();
      return;
    }

    // Ensure the cache is current (may lag one frame if update() wasn't called).
    if (this.cachedBlocksState !== this.view.state) {
      this.cachedBlocks = collectCodeBlocks(this.view.state);
      this.cachedBlocksState = this.view.state;
    }

    const block = findFencedBlockAt(this.cachedBlocks, pos);
    if (!block) {
      this.clearHoveredHeader();
      return;
    }

    if (this.hoveredBlockOpenFence !== block.openFenceFrom) {
      this.clearHoveredHeader();
      this.hoveredBlockOpenFence = block.openFenceFrom;
    }
    this.refreshHoveredHeader();
  }

  handleMouseLeave(): void {
    this.clearHoveredHeader();
  }

  private refreshHoveredHeader(): void {
    if (this.hoveredBlockOpenFence === null) return;

    const block = this.cachedBlocks
      .find((candidate) => candidate.openFenceFrom === this.hoveredBlockOpenFence);
    if (!block) {
      this.clearHoveredHeader();
      return;
    }

    const focused = this.view.state.field(editorFocusField, false) ?? false;
    if (isCursorOnOpenFence(this.view.state, block, focused) || isCursorOnCloseFence(this.view.state, block, focused)) {
      this.clearHoveredHeader();
      return;
    }

    const headerEl = getLineElement(this.view, block.openFenceFrom);
    if (!headerEl || !headerEl.classList.contains("cf-codeblock-header")) {
      this.clearHoveredHeader();
      return;
    }

    if (this.hoveredHeaderEl && this.hoveredHeaderEl !== headerEl) {
      this.hoveredHeaderEl.classList.remove("cf-codeblock-hovered");
    }
    this.hoveredHeaderEl = headerEl;
    this.hoveredHeaderEl.classList.add("cf-codeblock-hovered");
  }

  private clearHoveredHeader(): void {
    if (this.hoveredHeaderEl) {
      this.hoveredHeaderEl.classList.remove("cf-codeblock-hovered");
      this.hoveredHeaderEl = null;
    }
    this.hoveredBlockOpenFence = null;
  }
}

/**
 * CM6 StateField that provides code block rendering decorations.
 *
 * Uses a StateField so that line decorations (Decoration.line) are
 * permitted by CM6.
 *
 * On doc change with tree change: incremental rebuild scoped to the dirty
 * region (filterFrom/filterTo) instead of full-document rebuild (#723).
 * On doc change without tree change: maps decoration positions only.
 * On cursor/focus/tree-only change: full rebuild.
 */
const codeBlockDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildCodeBlockDecorations(state);
  },

  update(value, tr) {
    // Focus effect: global cursor-awareness change — full rebuild
    if (tr.effects.some((e) => e.is(focusEffect))) {
      return buildCodeBlockDecorations(tr.state);
    }

    if (tr.docChanged) {
      const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState);
      const treeReady = syntaxTreeAvailable(tr.state, tr.state.doc.length);

      if (treeChanged && treeReady) {
        // Tree structure changed: incremental rebuild of dirty region only
        return incrementalCodeBlockUpdate(value, tr);
      }
      // Doc changed, tree unchanged (or not ready): map positions only
      return value.map(tr.changes);
    }

    // Selection or tree change without doc change: full rebuild
    if (
      tr.selection !== undefined ||
      (syntaxTree(tr.state) !== syntaxTree(tr.startState) &&
        syntaxTreeAvailable(tr.state, tr.state.doc.length))
    ) {
      return buildCodeBlockDecorations(tr.state);
    }

    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

/** Exported for unit testing decoration logic without a browser. */
export {
  codeBlockDecorationField as _codeBlockDecorationFieldForTest,
  codeBlockStructureField as _codeBlockStructureFieldForTest,
  computeCodeBlockDirtyRegion as _computeCodeBlockDirtyRegionForTest,
  incrementalCodeBlockUpdate as _incrementalCodeBlockUpdateForTest,
};

/** CM6 extension that renders fenced code blocks with language label and fence hiding. */
export const codeBlockRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  codeBlockDecorationField,
  // Closing fence protection and atomic ranges are provided by the unified
  // fenceProtectionExtension in fence-protection.ts (#441).
  ViewPlugin.fromClass(CodeBlockHoverPlugin, {
    eventHandlers: {
      mousemove(event) {
        this.handleMouseMove(event);
      },
      mouseleave() {
        this.handleMouseLeave();
      },
    },
  }),
];
