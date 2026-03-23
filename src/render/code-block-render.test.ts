import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { markdownExtensions } from "../parser";
import { editorFocusField, focusEffect } from "./render-utils";
import { _codeBlockDecorationFieldForTest as codeBlockDecorationField } from "./code-block-render";
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
    expect(hasLineClassAt(specs, state.doc.line(2).from, "cf-codeblock-last")).toBe(true);
    // Neither fence enters source mode.
    expect(hasLineClassAt(specs, state.doc.line(1).from, "cf-codeblock-source-open")).toBe(false);
    expect(hasLineClassAt(specs, state.doc.line(3).from, "cf-codeblock-source-close")).toBe(false);
  });

  it("handles empty code blocks (no body lines)", () => {
    const emptyBlock = "```js\n```";
    const state = createTestState(emptyBlock, 0, true);
    const specs = getDecoSpecs(state);

    // Cursor is on the opening fence — both fences should be in source mode
    expect(hasLineClassAt(specs, state.doc.line(1).from, "cf-codeblock-source-open")).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(2).from, "cf-codeblock-source-close")).toBe(true);
  });

  it("handles code block at end of document (no trailing newline)", () => {
    // A code block that ends at EOF without a trailing newline must not throw
    // and must still decorate correctly.
    const doc = "```py\nprint('hello')\n```";
    // Cursor far from fences — should render as header
    const bodyPos = doc.indexOf("print");
    const state = createTestState(doc, bodyPos, true);
    const specs = getDecoSpecs(state);

    expect(hasLineClassAt(specs, state.doc.line(1).from, "cf-codeblock-header")).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(3).from, "cf-include-fence")).toBe(true);
  });
});

describe("codeBlockDecorationField", () => {
  it("keeps code blocks rendered when cursor is inside the body", () => {
    const bodyPos = TWO_BLOCKS.indexOf("console.log");
    const state = createTestState(TWO_BLOCKS, bodyPos, true);
    const specs = getDecoSpecs(state);

    expect(hasLineClassAt(specs, state.doc.line(1).from, "cf-codeblock-header")).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(1).from, "cf-codeblock-source-open")).toBe(false);
    expect(hasLineClassAt(specs, state.doc.line(2).from, "cf-codeblock-last")).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(3).from, "cf-include-fence")).toBe(true);

    const widgets = specs.filter((s) => s.widgetClass === "SimpleTextRenderWidget");
    expect(widgets.length).toBe(2);
  });

  it("shows both fences when cursor is on the opening fence", () => {
    const state = createTestState(TWO_BLOCKS, 0, true);
    const specs = getDecoSpecs(state);

    expect(hasLineClassAt(specs, state.doc.line(1).from, "cf-codeblock-source-open")).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(1).from, "cf-codeblock-header")).toBe(false);
    expect(hasLineClassAt(specs, state.doc.line(2).from, "cf-codeblock-body")).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(2).from, "cf-codeblock-last")).toBe(false);
    expect(hasLineClassAt(specs, state.doc.line(3).from, "cf-codeblock-source-close")).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(3).from, "cf-include-fence")).toBe(false);

    const widgets = specs.filter((s) => s.widgetClass === "SimpleTextRenderWidget");
    expect(widgets.length).toBe(1);
  });

  it("shows both fences when cursor is on the closing fence", () => {
    const closeFencePos = TWO_BLOCKS.indexOf("```\n\n```py");
    const state = createTestState(TWO_BLOCKS, closeFencePos, true);
    const specs = getDecoSpecs(state);

    expect(hasLineClassAt(specs, state.doc.line(1).from, "cf-codeblock-source-open")).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(3).from, "cf-codeblock-source-close")).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(3).from, "cf-include-fence")).toBe(false);
  });

  it("other code blocks stay rendered when one block fence is active", () => {
    const state = createTestState(TWO_BLOCKS, 0, true);
    const specs = getDecoSpecs(state);

    expect(hasLineClassAt(specs, state.doc.line(5).from, "cf-codeblock-header")).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(5).from, "cf-codeblock-source-open")).toBe(false);
    expect(hasLineClassAt(specs, state.doc.line(7).from, "cf-include-fence")).toBe(true);
  });
});
