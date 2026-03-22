/**
 * Unit tests for blockDecorationField — tests decoration logic
 * without a browser by creating EditorState directly.
 *
 * Pattern: EditorState.create({doc, extensions}) → state.field(blockDecorationField)
 * to check which decorations are applied for a given document + cursor position.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { markdownExtensions } from "../parser";
import { _blockDecorationFieldForTest as blockDecorationField } from "./plugin-render";
import { createPluginRegistryField } from "./plugin-registry";
import { blockCounterField } from "./block-counter";
import { editorFocusField, focusEffect } from "../render/render-utils";
import { mathMacrosField } from "../render/math-macros";
import { frontmatterField } from "../editor/frontmatter-state";

/** Create an EditorState with all extensions needed for block decorations. */
function createTestState(doc: string, cursorPos = 0, focused = false) {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions: [
      markdown({ extensions: markdownExtensions }),
      frontmatterField,
      mathMacrosField,
      createPluginRegistryField([]),
      blockCounterField,
      editorFocusField,
      blockDecorationField,
    ],
  });

  if (focused) {
    // Dispatch focus effect to simulate editor focus
    return state.update({ effects: focusEffect.of(true) }).state;
  }
  return state;
}

/** Collect decoration specs from the blockDecorationField. */
function getDecoSpecs(state: EditorState) {
  const decoSet = state.field(blockDecorationField);
  const specs: Array<{
    from: number;
    to: number;
    class?: string;
    widgetClass?: string;
  }> = [];

  const cursor = decoSet.iter();
  while (cursor.value) {
    const spec = cursor.value.spec;
    specs.push({
      from: cursor.from,
      to: cursor.to,
      class: spec.class as string | undefined,
      widgetClass: spec.widget?.constructor?.name,
    });
    cursor.next();
  }
  return specs;
}

/** Check if any line decoration at a position has a specific CSS class. */
function hasLineClassAt(specs: ReturnType<typeof getDecoSpecs>, lineStart: number, classSubstr: string) {
  return specs.some(
    (s) => s.from === lineStart && s.from === s.to && s.class?.includes(classSubstr),
  );
}

const TWO_BLOCKS = [
  "::: {.theorem} Title",
  "Content",
  ":::",
  "",
  "::: {.proof}",
  "Proof text",
  ":::",
].join("\n");

describe("blockDecorationField", () => {
  it("renders header widget when cursor is not on fence (unfocused)", () => {
    const state = createTestState(TWO_BLOCKS);
    const specs = getDecoSpecs(state);

    // Should have decorations for both blocks
    expect(specs.length).toBeGreaterThan(0);

    // Opening fence lines should have cf-block-header class
    const theoremLine = state.doc.line(1).from;
    expect(hasLineClassAt(specs, theoremLine, "cf-block-header")).toBe(true);

    // Should have BlockHeaderWidget replacements
    const widgets = specs.filter((s) => s.widgetClass === "BlockHeaderWidget");
    expect(widgets.length).toBe(2); // theorem + proof
  });

  it("shows source when cursor is on opening fence (focused)", () => {
    const theoremStart = 0;
    const state = createTestState(TWO_BLOCKS, theoremStart, true);
    const specs = getDecoSpecs(state);

    // Opening fence should have cf-block-source, not cf-block-header
    const theoremLine = state.doc.line(1).from;
    expect(hasLineClassAt(specs, theoremLine, "cf-block-source")).toBe(true);
    expect(hasLineClassAt(specs, theoremLine, "cf-block-header")).toBe(false);

    // No header widget for theorem (source mode)
    // But proof should still have its header widget
    const proofLine = state.doc.line(5).from;
    expect(hasLineClassAt(specs, proofLine, "cf-block-header")).toBe(true);
  });

  it("hides closing fence when cursor is not on it", () => {
    // Cursor on line 2 (content, not fence)
    const contentPos = TWO_BLOCKS.indexOf("Content");
    const state = createTestState(TWO_BLOCKS, contentPos, true);
    const specs = getDecoSpecs(state);

    // Closing fence line (:::) should have cf-include-fence (collapsed)
    const closeFenceLine = state.doc.line(3).from;
    expect(hasLineClassAt(specs, closeFenceLine, "cf-include-fence")).toBe(true);
  });

  it("shows closing fence source when cursor is on closing fence", () => {
    const closeFencePos = TWO_BLOCKS.indexOf(":::\n\n::: {.proof}");
    const state = createTestState(TWO_BLOCKS, closeFencePos, true);
    const specs = getDecoSpecs(state);

    // Closing fence should have cf-block-source (visible)
    const closeFenceLine = state.doc.line(3).from;
    expect(hasLineClassAt(specs, closeFenceLine, "cf-block-source")).toBe(true);
    expect(hasLineClassAt(specs, closeFenceLine, "cf-include-fence")).toBe(false);
  });

  it("shows both fences when cursor is on opening fence", () => {
    const state = createTestState(TWO_BLOCKS, 0, true);
    const specs = getDecoSpecs(state);

    // Opening: source mode
    expect(hasLineClassAt(specs, state.doc.line(1).from, "cf-block-source")).toBe(true);

    // Closing: also source mode (show both fences)
    const closeFenceLine = state.doc.line(3).from;
    expect(hasLineClassAt(specs, closeFenceLine, "cf-block-source")).toBe(true);
    expect(hasLineClassAt(specs, closeFenceLine, "cf-include-fence")).toBe(false);
  });

  it("other blocks unaffected when cursor is on one block's fence", () => {
    // Cursor on theorem opening fence
    const state = createTestState(TWO_BLOCKS, 0, true);
    const specs = getDecoSpecs(state);

    // Proof block should be fully rendered (not in source mode)
    const proofOpenLine = state.doc.line(5).from;
    expect(hasLineClassAt(specs, proofOpenLine, "cf-block-header")).toBe(true);
    expect(hasLineClassAt(specs, proofOpenLine, "cf-block-source")).toBe(false);

    // Proof closing fence should be hidden
    const proofCloseLine = state.doc.line(7).from;
    expect(hasLineClassAt(specs, proofCloseLine, "cf-include-fence")).toBe(true);
  });

  it("includes title in header widget replace range", () => {
    const doc = `::: {.theorem} **Main Result**\nContent\n:::`;
    const state = createTestState(doc);
    const specs = getDecoSpecs(state);

    // Widget should cover the entire opening line (including title)
    const widgets = specs.filter((s) => s.widgetClass === "BlockHeaderWidget");
    expect(widgets.length).toBe(1);

    const line1 = state.doc.line(1);
    // Replace range should cover from line start to end of title
    expect(widgets[0].from).toBe(line1.from);
    expect(widgets[0].to).toBe(line1.to);
  });

  it("does not crash on an incomplete fenced div without a closing fence", () => {
    const doc = [
      "::: {.definition}",
      "Body",
    ].join("\n");

    expect(() => {
      const state = createTestState(doc, 0, true);
      getDecoSpecs(state);
    }).not.toThrow();
  });
});
