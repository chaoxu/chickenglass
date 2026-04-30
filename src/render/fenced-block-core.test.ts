import { describe, expect, it } from "vitest";
import { Decoration } from "@codemirror/view";
import { createEditorState } from "../test-utils";
import {
  isCursorOnOpenFence,
  isCursorOnCloseFence,
  getFencedBlockRenderContext,
  findFencedBlockAt,
  addSingleLineClosingFence,
  addCollapsedClosingFence,
  hideMultiLineClosingFence,
  type FencedBlockInfo,
} from "./fenced-block-core";
import type { Range } from "@codemirror/state";
import { CSS } from "../constants/css-classes";

/** Helper to build a simple FencedBlockInfo for a multi-line block. */
function makeBlock(doc: string, openLine: number, closeLine: number): FencedBlockInfo {
  const state = createEditorState(doc);
  const open = state.doc.line(openLine);
  const close = state.doc.line(closeLine);
  return {
    from: open.from,
    to: close.to,
    openFenceFrom: open.from,
    openFenceTo: open.to,
    closeFenceFrom: close.from,
    closeFenceTo: close.to,
    singleLine: false,
  };
}

// ── isCursorOnOpenFence ──────────────────────────────────────────────

describe("isCursorOnOpenFence", () => {
  const doc = "::: {.theorem}\nContent\n:::";

  it("returns true when cursor is at the start of the open fence line", () => {
    const block = makeBlock(doc, 1, 3);
    const state = createEditorState(doc, { cursorPos: 0 });
    expect(isCursorOnOpenFence(state, block, true)).toBe(true);
  });

  it("returns true when cursor is at the end of the open fence line", () => {
    const block = makeBlock(doc, 1, 3);
    const state = createEditorState(doc, { cursorPos: 14 });
    expect(isCursorOnOpenFence(state, block, true)).toBe(true);
  });

  it("returns true when cursor is in the middle of the open fence line", () => {
    const block = makeBlock(doc, 1, 3);
    const state = createEditorState(doc, { cursorPos: 5 });
    expect(isCursorOnOpenFence(state, block, true)).toBe(true);
  });

  it("returns false when cursor is on the content line", () => {
    const block = makeBlock(doc, 1, 3);
    const state = createEditorState(doc, { cursorPos: 15 });
    expect(isCursorOnOpenFence(state, block, true)).toBe(false);
  });

  it("returns false when cursor is on the closing fence", () => {
    const block = makeBlock(doc, 1, 3);
    const state = createEditorState(doc, { cursorPos: 23 });
    expect(isCursorOnOpenFence(state, block, true)).toBe(false);
  });

  it("returns false when editor is not focused", () => {
    const block = makeBlock(doc, 1, 3);
    const state = createEditorState(doc, { cursorPos: 0 });
    expect(isCursorOnOpenFence(state, block, false)).toBe(false);
  });
});

// ── isCursorOnCloseFence ─────────────────────────────────────────────

describe("isCursorOnCloseFence", () => {
  const doc = "::: {.theorem}\nContent\n:::";
  // Offsets: line 1 = 0..14, line 2 = 15..21, \n at 22, line 3 = 23..25

  it("returns true when cursor is at the start of the close fence", () => {
    const block = makeBlock(doc, 1, 3);
    const state = createEditorState(doc, { cursorPos: 23 });
    expect(isCursorOnCloseFence(state, block, true)).toBe(true);
  });

  it("returns true when cursor is at the end of the close fence", () => {
    const block = makeBlock(doc, 1, 3);
    const state = createEditorState(doc, { cursorPos: 25 });
    expect(isCursorOnCloseFence(state, block, true)).toBe(true);
  });

  it("returns false when cursor is on the open fence", () => {
    const block = makeBlock(doc, 1, 3);
    const state = createEditorState(doc, { cursorPos: 0 });
    expect(isCursorOnCloseFence(state, block, true)).toBe(false);
  });

  it("returns false when editor is not focused", () => {
    const block = makeBlock(doc, 1, 3);
    const state = createEditorState(doc, { cursorPos: 23 });
    expect(isCursorOnCloseFence(state, block, false)).toBe(false);
  });

  it("returns false when closeFenceFrom is -1 (incomplete tree)", () => {
    const block: FencedBlockInfo = {
      from: 0,
      to: 25,
      openFenceFrom: 0,
      openFenceTo: 14,
      closeFenceFrom: -1,
      closeFenceTo: -1,
      singleLine: false,
    };
    const state = createEditorState(doc, { cursorPos: 23 });
    expect(isCursorOnCloseFence(state, block, true)).toBe(false);
  });
});

// ── getFencedBlockRenderContext ───────────────────────────────────────

describe("getFencedBlockRenderContext", () => {
  const doc = "::: {.proof}\nLine one\nLine two\n:::";

  it("computes bodyLineCount correctly for multi-line block", () => {
    const block = makeBlock(doc, 1, 4);
    const state = createEditorState(doc, { cursorPos: 0 });
    const ctx = getFencedBlockRenderContext(state, block, true);
    expect(ctx.bodyLineCount).toBe(2);
  });

  it("reports cursorOnEitherFence when cursor on open fence", () => {
    const block = makeBlock(doc, 1, 4);
    const state = createEditorState(doc, { cursorPos: 0 });
    const ctx = getFencedBlockRenderContext(state, block, true);
    expect(ctx.cursorOnOpenFence).toBe(true);
    expect(ctx.cursorOnCloseFence).toBe(false);
    expect(ctx.cursorOnEitherFence).toBe(true);
  });

  it("reports cursorOnEitherFence when cursor on close fence", () => {
    const block = makeBlock(doc, 1, 4);
    const state = createEditorState(doc, { cursorPos: block.closeFenceFrom });
    const ctx = getFencedBlockRenderContext(state, block, true);
    expect(ctx.cursorOnOpenFence).toBe(false);
    expect(ctx.cursorOnCloseFence).toBe(true);
    expect(ctx.cursorOnEitherFence).toBe(true);
  });

  it("reports neither fence when cursor is on body", () => {
    const block = makeBlock(doc, 1, 4);
    // Place cursor just past the open fence line (start of body)
    const state = createEditorState(doc, { cursorPos: block.openFenceTo + 1 });
    const ctx = getFencedBlockRenderContext(state, block, false);
    expect(ctx.cursorOnOpenFence).toBe(false);
    expect(ctx.cursorOnCloseFence).toBe(false);
    expect(ctx.cursorOnEitherFence).toBe(false);
  });

  it("falls back to openLine for closeLine when closeFenceFrom is -1", () => {
    const block: FencedBlockInfo = {
      from: 0,
      to: 14,
      openFenceFrom: 0,
      openFenceTo: 14,
      closeFenceFrom: -1,
      closeFenceTo: -1,
      singleLine: false,
    };
    const state = createEditorState("::: {.theorem}\n", { cursorPos: 0 });
    const ctx = getFencedBlockRenderContext(state, block, true);
    // closeLine falls back to openLine, so bodyLineCount is 0
    expect(ctx.bodyLineCount).toBe(0);
    expect(ctx.closeLine.number).toBe(ctx.openLine.number);
  });

  it("computes bodyLineCount 0 for a single-line block", () => {
    const singleDoc = "::: {.theorem} Title :::";
    const block: FencedBlockInfo = {
      from: 0,
      to: singleDoc.length,
      openFenceFrom: 0,
      openFenceTo: 14,
      closeFenceFrom: 21,
      closeFenceTo: singleDoc.length,
      singleLine: true,
    };
    const state = createEditorState(singleDoc, { cursorPos: 0 });
    const ctx = getFencedBlockRenderContext(state, block, true);
    // Open and close are on the same line
    expect(ctx.bodyLineCount).toBe(0);
  });
});

// ── findFencedBlockAt ────────────────────────────────────────────────

describe("findFencedBlockAt", () => {
  const blocks: FencedBlockInfo[] = [
    { from: 0, to: 20, openFenceFrom: 0, openFenceTo: 10, closeFenceFrom: 17, closeFenceTo: 20, singleLine: false },
    { from: 30, to: 50, openFenceFrom: 30, openFenceTo: 40, closeFenceFrom: 47, closeFenceTo: 50, singleLine: false },
  ];

  it("returns the block containing the position", () => {
    expect(findFencedBlockAt(blocks, 5)).toBe(blocks[0]);
    expect(findFencedBlockAt(blocks, 35)).toBe(blocks[1]);
  });

  it("returns the block when position is at the boundary", () => {
    expect(findFencedBlockAt(blocks, 0)).toBe(blocks[0]);
    expect(findFencedBlockAt(blocks, 20)).toBe(blocks[0]);
    expect(findFencedBlockAt(blocks, 30)).toBe(blocks[1]);
    expect(findFencedBlockAt(blocks, 50)).toBe(blocks[1]);
  });

  it("returns null when position is outside all blocks", () => {
    expect(findFencedBlockAt(blocks, 25)).toBeNull();
  });

  it("returns null for an empty block list", () => {
    expect(findFencedBlockAt([], 0)).toBeNull();
  });
});

// ── addSingleLineClosingFence ────────────────────────────────────────

describe("addSingleLineClosingFence", () => {
  it("adds a hidden decoration covering the closing fence", () => {
    const doc = "::: {.theorem} Title :::";
    const state = createEditorState(doc);
    const items: Range<Decoration>[] = [];
    addSingleLineClosingFence(state, 21, 24, items);
    expect(items).toHaveLength(1);
    expect(items[0].from).toBe(20); // trims preceding space
    expect(items[0].to).toBe(24);
  });

  it("trims whitespace before the closing fence", () => {
    const doc = "::: {.theorem} Title   :::";
    const state = createEditorState(doc);
    const items: Range<Decoration>[] = [];
    // closeFenceFrom is at 23 (":::"), whitespace at 20-22
    addSingleLineClosingFence(state, 23, 26, items);
    expect(items).toHaveLength(1);
    expect(items[0].from).toBe(20); // trimmed to before whitespace
    expect(items[0].to).toBe(26);
  });

  it("does nothing when closeFenceFrom is -1", () => {
    const doc = "::: {.theorem} Title";
    const state = createEditorState(doc);
    const items: Range<Decoration>[] = [];
    addSingleLineClosingFence(state, -1, -1, items);
    expect(items).toHaveLength(0);
  });

  it("does nothing when closeFenceTo < closeFenceFrom", () => {
    const doc = "::: {.theorem} Title :::";
    const state = createEditorState(doc);
    const items: Range<Decoration>[] = [];
    addSingleLineClosingFence(state, 21, 20, items);
    expect(items).toHaveLength(0);
  });

  it("does nothing when closeFenceTo === closeFenceFrom (empty range)", () => {
    const doc = "::: {.theorem} Title :::";
    const state = createEditorState(doc);
    const items: Range<Decoration>[] = [];
    addSingleLineClosingFence(state, 21, 21, items);
    expect(items).toHaveLength(0);
  });
});

// ── hideMultiLineClosingFence ────────────────────────────────────────

describe("hideMultiLineClosingFence", () => {
  it("adds a zero-height block replacement for the closing-fence line", () => {
    const state = createEditorState("before\n:::\nafter");
    const closeLine = state.doc.line(2);
    const items: Range<Decoration>[] = [];
    hideMultiLineClosingFence(state, closeLine.from, closeLine.to, items);
    expect(items).toHaveLength(1);

    expect(items[0].from).toBe(closeLine.from);
    expect(items[0].to).toBe(closeLine.to);
    expect(items[0].value.spec.block).toBe(true);
    expect(items[0].value.spec.class).toBe(CSS.blockClosingFence);
    expect(items[0].value.spec.widget.estimatedHeight).toBe(0);
  });

  it("does nothing when closeFenceFrom is -1", () => {
    const state = createEditorState("before\n:::\nafter");
    const items: Range<Decoration>[] = [];
    hideMultiLineClosingFence(state, -1, -1, items);
    expect(items).toHaveLength(0);
  });

  it("does nothing when closeFenceTo < closeFenceFrom", () => {
    const state = createEditorState("before\n:::\nafter");
    const items: Range<Decoration>[] = [];
    hideMultiLineClosingFence(state, 13, 10, items);
    expect(items).toHaveLength(0);
  });

  it("does nothing when closeFenceTo === closeFenceFrom (empty range)", () => {
    const state = createEditorState("before\n:::\nafter");
    const items: Range<Decoration>[] = [];
    hideMultiLineClosingFence(state, 10, 10, items);
    expect(items).toHaveLength(0);
  });
});

// ── addCollapsedClosingFence ─────────────────────────────────────────

describe("addCollapsedClosingFence", () => {
  it("adds a zero-height block replacement", () => {
    const state = createEditorState("before\n:::\nafter");
    const closeLine = state.doc.line(2);
    const items: Range<Decoration>[] = [];
    addCollapsedClosingFence(state, closeLine.from, closeLine.to, items);
    expect(items).toHaveLength(1);

    expect(items[0].from).toBe(closeLine.from);
    expect(items[0].to).toBe(closeLine.to);
    expect(items[0].value.spec.block).toBe(true);
    expect(items[0].value.spec.class).toBe(CSS.blockClosingFence);
  });

  it("does nothing when closeFenceFrom is -1", () => {
    const state = createEditorState("before\n:::\nafter");
    const items: Range<Decoration>[] = [];
    addCollapsedClosingFence(state, -1, -1, items);
    expect(items).toHaveLength(0);
  });

  it("does nothing when closeFenceTo < closeFenceFrom", () => {
    const state = createEditorState("before\n:::\nafter");
    const items: Range<Decoration>[] = [];
    addCollapsedClosingFence(state, 13, 10, items);
    expect(items).toHaveLength(0);
  });

  it("does nothing when closeFenceTo === closeFenceFrom (empty range)", () => {
    const state = createEditorState("before\n:::\nafter");
    const items: Range<Decoration>[] = [];
    addCollapsedClosingFence(state, 10, 10, items);
    expect(items).toHaveLength(0);
  });
});
