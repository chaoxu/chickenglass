import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { CSS } from "../constants/css-classes";
import { markdown } from "@codemirror/lang-markdown";
import { markdownExtensions } from "../parser";
import { editorFocusField, focusEffect } from "./render-utils";
import {
  _codeBlockDecorationFieldForTest as codeBlockDecorationField,
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
    expect(hasLineClassAt(specs, state.doc.line(2).from, CSS.codeblockBody)).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(2).from, CSS.codeblockLast)).toBe(false);
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
