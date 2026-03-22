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

describe("codeBlockDecorationField", () => {
  it("keeps code blocks rendered when cursor is inside the body", () => {
    const bodyPos = TWO_BLOCKS.indexOf("console.log");
    const state = createTestState(TWO_BLOCKS, bodyPos, true);
    const specs = getDecoSpecs(state);

    expect(hasLineClassAt(specs, state.doc.line(1).from, "cf-codeblock-header")).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(1).from, "cf-codeblock-source-open")).toBe(false);
    expect(hasLineClassAt(specs, state.doc.line(2).from, "cf-codeblock-last")).toBe(true);
    expect(hasLineClassAt(specs, state.doc.line(3).from, "cf-include-fence")).toBe(true);

    const widgets = specs.filter((s) => s.widgetClass === "CodeBlockHeaderWidget");
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

    const widgets = specs.filter((s) => s.widgetClass === "CodeBlockHeaderWidget");
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
