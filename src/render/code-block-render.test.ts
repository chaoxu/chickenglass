import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import * as language from "@codemirror/language";
import { CSS } from "../constants/css-classes";
import { markdown } from "@codemirror/lang-markdown";
import { markdownExtensions } from "../parser";
import { editorFocusField, focusEffect } from "./render-utils";
import {
  collectCodeBlocks,
  _codeBlockDecorationFieldForTest as codeBlockDecorationField,
  _codeBlockStructureFieldForTest as codeBlockStructureField,
  _computeCodeBlockDirtyRegionForTest as computeCodeBlockDirtyRegion,
  _incrementalCodeBlockUpdateForTest as incrementalCodeBlockUpdate,
} from "./code-block-render";
import { closingFenceProtection } from "../plugins/fence-protection";
import {
  applyStateEffects,
  createEditorState,
  getDecorationSpecs,
  hasLineClassAt,
} from "../test-utils";

function createTestState(doc: string, cursorPos = 0, focused = false) {
  const state = createEditorState(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      editorFocusField,
      codeBlockStructureField,
      codeBlockDecorationField,
    ],
  });

  return focused ? applyStateEffects(state, focusEffect.of(true)) : state;
}

function getDecoSpecs(state: EditorState) {
  return getDecorationSpecs(state.field(codeBlockDecorationField));
}

const TWO_BLOCKS = [
  "```js",
  "console.log('x')",
  "```",
  "",
  "```py",
  "print('y')",
  "```",
].join("\n");

describe("edge cases", () => {
  it("does NOT show source when cursor is in the body (body stays rendered)", () => {
    // Placing the cursor on the last body line must NOT trigger source mode for
    // the fences. This is the Typora-style rule: only cursor contact with a
    // fence line reveals source; body lines never do.
    const bodyPos = TWO_BLOCKS.indexOf("console.log");
    const state = createTestState(TWO_BLOCKS, bodyPos, true);
    const specs = getDecoSpecs(state);

    // The last body line gets cf-codeblock-last (renders with bottom border),
    // not cf-codeblock-body (used for middle lines), when the cursor is on it.
    expect(hasLineClassAt(specs, state.doc.line(2).from, CSS.codeblockLast)).toBe(true);
    // Opening fence does not enter source mode.
    expect(hasLineClassAt(specs, state.doc.line(1).from, CSS.codeblockSourceOpen)).toBe(false);
    // Closing fence is always hidden (#429) — never shows source.
    expect(hasLineClassAt(specs, state.doc.line(3).from, CSS.blockClosingFence)).toBe(true);
  });

  it("handles empty code blocks (no body lines)", () => {
    const emptyBlock = "```js\n```";
    const state = createTestState(emptyBlock, 0, true);
    const specs = getDecoSpecs(state);

    // Cursor is on the opening fence — opening fence in source mode
    expect(hasLineClassAt(specs, state.doc.line(1).from, CSS.codeblockSourceOpen)).toBe(true);
    // Closing fence is always hidden (#429) — never shows source
    expect(hasLineClassAt(specs, state.doc.line(2).from, CSS.blockClosingFence)).toBe(true);
  });

  it("handles code block at end of document (no trailing newline)", () => {
    // A code block that ends at EOF without a trailing newline must not throw
    // and must still decorate correctly.
    const doc = "```py\nprint('hello')\n```";
    // Cursor far from fences — should render as header
    const bodyPos = doc.indexOf("print");
    const state = createTestState(doc, bodyPos, true);
    const specs = getDecoSpecs(state);

    expect(hasLineClassAt(specs, state.doc.line(1).from, CSS.codeblockHeader)).toBe(true);
    // Closing fence is always hidden (#429)
    expect(hasLineClassAt(specs, state.doc.line(3).from, CSS.blockClosingFence)).toBe(true);
  });
});

describe("codeBlockDecorationField", () => {
  it("reads code blocks from the shared cache without rescanning the tree", () => {
    const state = createEditorState(TWO_BLOCKS, {
      extensions: [
        markdown({ extensions: markdownExtensions }),
        codeBlockStructureField,
      ],
    });
    const cachedBlocks = state.field(codeBlockStructureField);

    // A fresh syntax-tree scan would allocate a new array. The public helper
    // must hand back the shared field value directly so rich-mode consumers
    // reuse the cached block structure instead of rediscovering it.
    expect(collectCodeBlocks(state)).toBe(cachedBlocks);
  });

  it("reuses the cached block structure on selection-only updates", () => {
    const state = createEditorState(TWO_BLOCKS, {
      extensions: [
        markdown({ extensions: markdownExtensions }),
        codeBlockStructureField,
      ],
    });
    const initialBlocks = state.field(codeBlockStructureField);
    const movedState = state.update({
      selection: { anchor: TWO_BLOCKS.indexOf("print") },
    }).state;

    expect(movedState.field(codeBlockStructureField)).toBe(initialBlocks);
  });

  it("keeps code blocks rendered when cursor is inside the body", () => {
    const bodyPos = TWO_BLOCKS.indexOf("console.log");
    const state = createTestState(TWO_BLOCKS, bodyPos, true);
    const specs = getDecoSpecs(state);

    expect(hasLineClassAt(specs, state.doc.line(1).from, CSS.codeblockHeader)).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(1).from, CSS.codeblockSourceOpen)).toBe(false);
    expect(hasLineClassAt(specs, state.doc.line(2).from, CSS.codeblockLast)).toBe(true);
    // Closing fence always hidden (#429)
    expect(hasLineClassAt(specs, state.doc.line(3).from, CSS.blockClosingFence)).toBe(true);

    const widgets = specs.filter((s) => s.widgetClass === "SimpleTextRenderWidget");
    expect(widgets.length).toBe(2);
  });

  it("shows opening fence as source when cursor is on it, closing fence stays hidden", () => {
    const state = createTestState(TWO_BLOCKS, 0, true);
    const specs = getDecoSpecs(state);

    // Opening fence shows as source
    expect(hasLineClassAt(specs, state.doc.line(1).from, CSS.codeblockSourceOpen)).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(1).from, CSS.codeblockHeader)).toBe(false);
    expect(hasLineClassAt(specs, state.doc.line(2).from, CSS.codeblockBody)).toBe(false);
    expect(hasLineClassAt(specs, state.doc.line(2).from, CSS.codeblockLast)).toBe(true);
    // Closing fence always hidden (#429) — no source mode
    expect(hasLineClassAt(specs, state.doc.line(3).from, CSS.blockClosingFence)).toBe(true);

    const widgets = specs.filter((s) => s.widgetClass === "SimpleTextRenderWidget");
    expect(widgets.length).toBe(1);
  });

  it("closing fence stays hidden even when cursor is on it", () => {
    // In practice atomicRanges prevent cursor from landing here, but
    // the decoration must still hide it correctly.
    const closeFencePos = TWO_BLOCKS.indexOf("```\n\n```py");
    const state = createTestState(TWO_BLOCKS, closeFencePos, true);
    const specs = getDecoSpecs(state);

    // Opening fence shows as source (cursorOnEitherFence is true)
    expect(hasLineClassAt(specs, state.doc.line(1).from, CSS.codeblockSourceOpen)).toBe(true);
    // Closing fence always hidden (#429)
    expect(hasLineClassAt(specs, state.doc.line(3).from, CSS.blockClosingFence)).toBe(true);
  });

  it("other code blocks stay rendered when one block fence is active", () => {
    const state = createTestState(TWO_BLOCKS, 0, true);
    const specs = getDecoSpecs(state);

    expect(hasLineClassAt(specs, state.doc.line(5).from, CSS.codeblockHeader)).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(5).from, CSS.codeblockSourceOpen)).toBe(false);
    // Closing fence always hidden (#429)
    expect(hasLineClassAt(specs, state.doc.line(7).from, CSS.blockClosingFence)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Closing fence protection transaction filter (#434, unified in #441)
// ---------------------------------------------------------------------------

/**
 * Create an EditorState with the unified closing fence protection filter active.
 * Includes the markdown parser so FencedCode nodes are recognized.
 * Uses the unified closingFenceProtection from fence-protection.ts (#441).
 */
function createProtectedState(doc: string) {
  return createEditorState(doc, {
    extensions: [
      markdown({ extensions: markdownExtensions }),
      closingFenceProtection,
    ],
  });
}

describe("closingCodeFenceProtection (unified)", () => {
  const doc = "```js\nconsole.log('x')\n```";

  it("blocks deletion of closing fence line", () => {
    const state = createProtectedState(doc);
    const closingLine = state.doc.line(3);
    const tr = state.update({
      changes: { from: closingLine.from, to: closingLine.to, insert: "" },
    });
    // Transaction should be blocked — doc unchanged
    expect(tr.state.doc.toString()).toBe(doc);
  });

  it("allows whole-document deletion of a single code block (#434)", () => {
    // When the entire document is a single code block, select-all + delete
    // must not be blocked. Before the fix, fromA === 0 was not recognized as
    // "extends before fence" and toA === docLen was not recognized as
    // "extends after fence", so the filter incorrectly blocked the deletion.
    const state = createProtectedState(doc);
    const tr = state.update({
      changes: { from: 0, to: doc.length, insert: "" },
    });
    expect(tr.state.doc.toString()).toBe("");
  });

  it("allows deletion from content through end of doc (boundary edge case)", () => {
    const state = createProtectedState(doc);
    const contentLine = state.doc.line(2);
    // Delete from content through closing fence — exercises toA >= docLen path
    const tr = state.update({
      changes: { from: contentLine.from, to: doc.length, insert: "" },
    });
    expect(tr.state.doc.toString()).not.toBe(doc);
  });

  it("allows whole-block deletion spanning beyond fence in larger document", () => {
    const larger = "before\n```js\nconsole.log('x')\n```\nafter";
    const state = createProtectedState(larger);
    const tr = state.update({
      changes: { from: 0, to: larger.length, insert: "" },
    });
    expect(tr.state.doc.toString()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Incremental doc-change update (#723)
// ---------------------------------------------------------------------------

/**
 * Create an EditorState with forced tree parse, suitable for testing
 * incremental updates that depend on tree comparison.
 */
function createParsedState(doc: string, cursorPos = 0) {
  const state = createEditorState(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      editorFocusField,
      codeBlockStructureField,
      codeBlockDecorationField,
    ],
  });
  language.ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

describe("computeCodeBlockDirtyRegion (#723)", () => {
  it("covers the full extent of a destroyed code block", () => {
    const doc = "```js\nconsole.log('x')\n```";
    const state = createParsedState(doc);

    // Delete the opening fence markers (```)
    const tr = state.update({ changes: { from: 0, to: 3, insert: "" } });
    language.ensureSyntaxTree(tr.state, tr.state.doc.length, 5000);

    const dirty = computeCodeBlockDirtyRegion(tr);
    expect(dirty).not.toBeNull();
    // The old block spanned the entire doc (0..22). After deleting 3 chars,
    // the mapped block end is at 19 (= old doc.length - 3). The dirty region
    // must cover this full mapped range so stale body/closing decorations
    // inside it are filtered out.
    expect(dirty!.filterFrom).toBe(0);
    expect(dirty!.filterTo).toBeGreaterThanOrEqual(tr.state.doc.length - 1);
  });

  it("covers a newly created code block", () => {
    const doc = "line one\nline two";
    const state = createParsedState(doc);

    // Insert a code fence that creates a new block
    const tr = state.update({
      changes: { from: 0, to: 0, insert: "```py\n" },
    });
    language.ensureSyntaxTree(tr.state, tr.state.doc.length, 5000);

    const dirty = computeCodeBlockDirtyRegion(tr);
    expect(dirty).not.toBeNull();
    // The new FencedCode block should be covered
    expect(dirty!.filterFrom).toBe(0);
  });

  it("returns null when changes do not affect any code block", () => {
    const doc = "hello\n\n```js\ncode\n```\n\nworld";
    const state = createParsedState(doc);

    // Edit "hello" → "hi" (far from the code block)
    const tr = state.update({
      changes: { from: 0, to: 5, insert: "hi" },
    });
    language.ensureSyntaxTree(tr.state, tr.state.doc.length, 5000);

    const dirty = computeCodeBlockDirtyRegion(tr);
    // The changed range [0,2] doesn't overlap any FencedCode node,
    // so the dirty region is just the changed range itself, not null
    expect(dirty).not.toBeNull();
    // But the dirty range should NOT extend to the code block
    expect(dirty!.filterTo).toBeLessThan(tr.state.doc.line(3).from);
  });
});

describe("incrementalCodeBlockUpdate (#723)", () => {
  it("removes stale decorations when a code block is destroyed", () => {
    // Regression test for PR #736 review: deleting the opening fence of a
    // code block must clear all body/closing-fence decorations, not leave
    // them behind because the incremental path only looks at the new tree.
    const doc = "```py\ncode line\n```";
    const state = createParsedState(doc);
    const initialDecos = state.field(codeBlockDecorationField);

    // Verify initial decorations exist
    const specsBefore = getDecorationSpecs(initialDecos);
    expect(specsBefore.some((s) => s.class?.includes(CSS.codeblockHeader))).toBe(true);

    // Delete all 3 backticks from the opening fence
    const tr = state.update({ changes: { from: 0, to: 3, insert: "" } });
    language.ensureSyntaxTree(tr.state, tr.state.doc.length, 5000);

    // Directly invoke the incremental update function
    const result = incrementalCodeBlockUpdate(initialDecos, tr);

    // No code block exists in the new doc ("py\ncode line\n```" has ``` as
    // a new unclosed fence, but the OLD block's body decorations for "code line"
    // at their original positions must be removed). Check that decorations
    // in the old block's range are gone.
    const specsAfter = getDecorationSpecs(result);

    // The old "code line" body decoration was on old line 2 (mapped through
    // the deletion). It should be removed because it falls in the dirty region.
    const oldBodyPos = tr.changes.mapPos(state.doc.line(2).from);
    const hasStaleBodyAtOldPos = specsAfter.some(
      (s) =>
        s.from === oldBodyPos &&
        (s.class?.includes(CSS.codeblockBody) || s.class?.includes(CSS.codeblockLast)),
    );
    expect(hasStaleBodyAtOldPos).toBe(false);
  });

  it("preserves decorations for blocks outside the dirty region", () => {
    const doc = [
      "```js",
      "console.log('a')",
      "```",
      "",
      "some prose here",
      "",
      "```py",
      "print('b')",
      "```",
    ].join("\n");
    const state = createParsedState(doc);
    const initialDecos = state.field(codeBlockDecorationField);

    // Both blocks should be decorated
    const specsBefore = getDecorationSpecs(initialDecos);
    const headersBefore = specsBefore.filter((s) => s.class?.includes(CSS.codeblockHeader)).length;
    expect(headersBefore).toBe(2);

    // Edit prose between the two blocks (no code block affected)
    const proseLineStart = state.doc.line(5).from;
    const tr = state.update({
      changes: {
        from: proseLineStart,
        to: proseLineStart + "some prose here".length,
        insert: "different text",
      },
    });
    language.ensureSyntaxTree(tr.state, tr.state.doc.length, 5000);

    const result = incrementalCodeBlockUpdate(initialDecos, tr);
    const specsAfter = getDecorationSpecs(result);
    const headersAfter = specsAfter.filter((s) => s.class?.includes(CSS.codeblockHeader)).length;
    expect(headersAfter).toBe(2);
  });
});
