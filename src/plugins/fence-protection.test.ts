/**
 * Unit tests for fence protection transaction filters.
 *
 * Tests the closing fence protection, opening fence colon/backtick/math
 * protection, and opening fence deletion cleanup filters that prevent
 * accidental structural damage to fenced divs, fenced code blocks, and
 * display math in rich mode.
 *
 * Moved from plugin-render.test.ts during fence-protection extraction (#433).
 * Unified to cover both fenced divs and code blocks (#441).
 * Extended to cover display math (#777).
 */

import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { markdownExtensions } from "../parser";
import {
  fenceOperationAnnotation,
  fenceProtectionExtension,
  getClosingFenceRanges,
  getOpeningFenceBacktickRanges,
  getOpeningMathDelimiterRanges,
} from "./fence-protection";
import { _blockDecorationFieldForTest as blockDecorationField } from "./plugin-render";
import { createPluginRegistryField } from "./plugin-registry";
import { blockCounterField } from "./block-counter";
import { documentSemanticsField } from "../semantics/codemirror-source";
import { editorFocusField, mathMacrosField } from "../render/render-core";
import { _codeBlockStructureFieldForTest as codeBlockStructureField } from "../render/code-block-render";
import { frontmatterField } from "../editor/frontmatter-state";
import {
  createEditorState,
  makeBlockPlugin,
} from "../test-utils";

/**
 * Create an EditorState with fence protection filters active.
 * Uses the full extensions needed for semantics + registry + protection.
 */
function createProtectedState(
  doc: string,
  plugins: ReturnType<typeof makeBlockPlugin>[] = [makeBlockPlugin({ name: "theorem" })],
) {
  return createEditorState(doc, {
    extensions: [
      markdown({ extensions: markdownExtensions }),
      frontmatterField,
      documentSemanticsField,
      mathMacrosField,
      createPluginRegistryField(plugins),
      blockCounterField,
      editorFocusField,
      blockDecorationField,
      fenceProtectionExtension,
    ],
  });
}

describe("openingFenceColonProtection", () => {
  const doc = `::: {.theorem}\ncontent\n:::`;

  it("blocks deletion of colon prefix on opening fence", () => {
    const state = createProtectedState(doc);
    // Try to delete the `:::` (positions 0-3)
    const tr = state.update({ changes: { from: 0, to: 3, insert: "" } });
    // Transaction should be blocked -- doc unchanged
    expect(tr.state.doc.toString()).toBe(doc);
  });

  it("blocks partial deletion of colons", () => {
    const state = createProtectedState(doc);
    // Try to delete one colon (position 0-1)
    const tr = state.update({ changes: { from: 0, to: 1, insert: "" } });
    expect(tr.state.doc.toString()).toBe(doc);
  });

  it("allows editing attributes after colons", () => {
    const state = createProtectedState(doc);
    // Change {.theorem} to {.lemma} -- positions 4-14
    // `::: {.theorem}` = 0:`:` 1:`:` 2:`:` 3:` ` 4:`{` ... 13:`}` (14 chars)
    const tr = state.update({
      changes: { from: 4, to: 14, insert: "{.lemma}" },
    });
    expect(tr.state.doc.toString()).toBe(`::: {.lemma}\ncontent\n:::`);
  });

  it("allows whole-block deletion spanning beyond fence", () => {
    const state = createProtectedState(doc);
    // Delete entire document
    const tr = state.update({
      changes: { from: 0, to: doc.length, insert: "" },
    });
    expect(tr.state.doc.toString()).toBe("");
  });

  it("allows edits with fenceOperationAnnotation bypass", () => {
    const state = createProtectedState(doc);
    // Delete colons with the bypass annotation
    const tr = state.update({
      changes: { from: 0, to: 3, insert: "::::" },
      annotations: fenceOperationAnnotation.of(true),
    });
    expect(tr.state.doc.toString()).toBe(`:::: {.theorem}\ncontent\n:::`);
  });

  it("protects nested block colons independently", () => {
    const nested = `:::: {.theorem}\n::: {.proof}\ninner\n:::\n::::`;
    const state = createProtectedState(nested, [
      makeBlockPlugin({ name: "theorem" }),
      makeBlockPlugin({ name: "proof" }),
    ]);
    // Try to delete the outer `::::` (0-4) -- should be blocked
    const tr1 = state.update({ changes: { from: 0, to: 4, insert: "" } });
    expect(tr1.state.doc.toString()).toBe(nested);

    // Try to delete the inner `:::` (line 2, starts at 16) -- should be blocked
    const innerLine = state.doc.line(2);
    const tr2 = state.update({
      changes: { from: innerLine.from, to: innerLine.from + 3, insert: "" },
    });
    expect(tr2.state.doc.toString()).toBe(nested);
  });

  it("allows pure insertion at position 0 when block starts there", () => {
    const state = createProtectedState(doc);
    // Insert text before the colons -- no colons are deleted
    const tr = state.update({
      changes: { from: 0, to: 0, insert: "text\n" },
    });
    expect(tr.state.doc.toString()).toBe(`text\n${doc}`);
  });
});

describe("closingFenceProtection", () => {
  const doc = `::: {.theorem}\ncontent\n:::`;

  it("blocks deletion of closing fence line", () => {
    const state = createProtectedState(doc);
    const closingLine = state.doc.line(3);
    const tr = state.update({
      changes: { from: closingLine.from, to: closingLine.to, insert: "" },
    });
    expect(tr.state.doc.toString()).toBe(doc);
  });

  it("allows whole-block deletion spanning beyond fence", () => {
    const state = createProtectedState(doc);
    const tr = state.update({
      changes: { from: 0, to: doc.length, insert: "" },
    });
    expect(tr.state.doc.toString()).toBe("");
  });

  it("allows deletion from content through end of doc (boundary edge case)", () => {
    const state = createProtectedState(doc);
    const contentLine = state.doc.line(2);
    // Delete from content through closing fence -- exercises toA >= docLen path
    const tr = state.update({
      changes: { from: contentLine.from, to: doc.length, insert: "" },
    });
    expect(tr.state.doc.toString()).not.toBe(doc);
  });

  it("allows whole-block deletion when content follows (atomic range boundary)", () => {
    // When a block is NOT at end of doc, atomic ranges snap the selection
    // to fence.to + 1. The protection check must use >= (not >) to allow this.
    const withAfter = `::: {.theorem}\ncontent\n:::\nafter`;
    const state = createProtectedState(withAfter);
    const closingLine = state.doc.line(3);
    // Simulate selection from before the block through fence.to + 1
    // (exactly where atomic ranges snap the cursor)
    const tr = state.update({
      changes: { from: 0, to: closingLine.to + 1, insert: "" },
    });
    expect(tr.state.doc.toString()).toBe("after");
  });
});

describe("openingFenceDeletionCleanup", () => {
  const doc = `::: {.theorem}\ncontent\n:::`;

  it("auto-removes closing fence when opening fence line is deleted", () => {
    const state = createProtectedState(doc);
    const openLine = state.doc.line(1);
    // Delete the full opening fence line (including newline)
    const tr = state.update({
      changes: { from: openLine.from, to: openLine.to + 1, insert: "" },
    });
    // Both fences removed, only content remains
    expect(tr.state.doc.toString()).toBe("content");
  });

  it("auto-removes closing fence when opening fence content is deleted", () => {
    const state = createProtectedState(doc);
    const openLine = state.doc.line(1);
    // Delete just the opening fence content (not the newline)
    const tr = state.update({
      changes: { from: openLine.from, to: openLine.to, insert: "" },
    });
    // Closing fence should also be removed
    expect(tr.state.doc.toString()).not.toContain(":::");
  });

  it("auto-removes closing fence when partial deletion breaks the colon prefix (#766)", () => {
    // Repro from #766: select `:::: {.the` from `:::: {.theorem} Gap Test` and delete
    const partial = `:::: {.theorem} Gap Test\ncontent\n::::`;
    const state = createProtectedState(partial);
    // `:::: {.the` = positions 0-10; colon protection allows this because
    // the selection spans past the colon prefix (atOrBeforeStart && pastColonEnd)
    const tr = state.update({
      changes: { from: 0, to: 10, insert: "" },
    });
    const result = tr.state.doc.toString();
    // Closing fence should be removed since the colon prefix is gone
    expect(result).not.toContain("::::");
  });

  it("auto-removes closing fence when deletion covers exactly the colon prefix", () => {
    const state = createProtectedState(doc);
    // Delete `:::` + the space = positions 0-4; spans past colon.to (3)
    const tr = state.update({
      changes: { from: 0, to: 4, insert: "" },
    });
    const result = tr.state.doc.toString();
    expect(result).not.toContain(":::");
  });

  it("does not remove closing fence for partial opening fence edits", () => {
    const state = createProtectedState(doc);
    // Delete only the attributes, not the whole line
    // This would be blocked by colon protection anyway, but test the
    // cleanup filter specifically -- it should NOT fire
    const tr = state.update({
      changes: { from: 4, to: 14, insert: "{.lemma}" },
    });
    const result = tr.state.doc.toString();
    expect(result).toContain("{.lemma}");
    // Closing fence still present
    expect(result.endsWith(":::")).toBe(true);
  });

  it("preserves content between fences when opening fence is deleted", () => {
    const withContent = `before\n::: {.theorem}\ncontent\n:::\nafter`;
    const state = createProtectedState(withContent);
    const openLine = state.doc.line(2);
    const tr = state.update({
      changes: { from: openLine.from, to: openLine.to + 1, insert: "" },
    });
    const result = tr.state.doc.toString();
    // Both fences removed, surrounding content preserved
    expect(result).toContain("before");
    expect(result).toContain("content");
    expect(result).toContain("after");
    expect(result).not.toContain(":::");
  });

  it("auto-removes closing fence for indented fenced div when prefix is deleted (#766)", () => {
    // Indented fenced div (e.g. inside a list item) — openFenceFrom points
    // to the first colon, which is past the line start.
    const indented = `- text\n\n  ::: {.theorem} Title\n  content\n  :::`;
    const state = createProtectedState(indented);
    // Find the opening fence line
    const openLine = state.doc.line(3); // "  ::: {.theorem} Title"
    const colonStart = openLine.from + 2; // skip two spaces of indentation
    // Delete from first colon past the prefix: `::: {.the` = 10 chars
    const tr = state.update({
      changes: { from: colonStart, to: colonStart + 10, insert: "" },
    });
    const result = tr.state.doc.toString();
    // Closing fence should be removed since the colon prefix is gone
    expect(result).not.toContain(":::");
  });

  it("auto-removes closing fence for indented fenced div on full-line deletion (#766)", () => {
    const indented = `- text\n\n  ::: {.theorem} Title\n  content\n  :::`;
    const state = createProtectedState(indented);
    const openLine = state.doc.line(3);
    // Delete the entire opening fence line (including newline)
    const tr = state.update({
      changes: { from: openLine.from, to: openLine.to + 1, insert: "" },
    });
    const result = tr.state.doc.toString();
    expect(result).not.toContain(":::");
  });
});

// ---------------------------------------------------------------------------
// Code block protection (#441) — unified with fenced div protection
// ---------------------------------------------------------------------------

/**
 * Create a minimal EditorState for code block protection tests.
 * Only needs the markdown parser and protection filters — no plugin registry
 * or semantics field required since code blocks are protected unconditionally.
 */
function createCodeBlockProtectedState(doc: string) {
  return createEditorState(doc, {
    extensions: [
      markdown({ extensions: markdownExtensions }),
      codeBlockStructureField,
      fenceProtectionExtension,
    ],
  });
}

describe("openingFenceBacktickProtection", () => {
  const doc = "```js\nconsole.log('x')\n```";

  it("blocks deletion of opening backtick prefix on code fences", () => {
    const state = createCodeBlockProtectedState(doc);
    const tr = state.update({ changes: { from: 0, to: 3, insert: "" } });
    expect(tr.state.doc.toString()).toBe(doc);
  });

  it("blocks partial deletion of opening backticks", () => {
    const state = createCodeBlockProtectedState(doc);
    const tr = state.update({ changes: { from: 0, to: 1, insert: "" } });
    expect(tr.state.doc.toString()).toBe(doc);
  });

  it("allows editing the info string after opening backticks", () => {
    const state = createCodeBlockProtectedState(doc);
    const tr = state.update({ changes: { from: 3, to: 5, insert: "ts" } });
    expect(tr.state.doc.toString()).toBe("```ts\nconsole.log('x')\n```");
  });

  it("allows whole-block deletion spanning beyond the opening fence", () => {
    const state = createCodeBlockProtectedState(doc);
    const tr = state.update({ changes: { from: 0, to: doc.length, insert: "" } });
    expect(tr.state.doc.toString()).toBe("");
  });

  it("allows edits with fenceOperationAnnotation bypass", () => {
    const state = createCodeBlockProtectedState(doc);
    const tr = state.update({
      changes: { from: 0, to: 3, insert: "````" },
      annotations: fenceOperationAnnotation.of(true),
    });
    expect(tr.state.doc.toString()).toBe("````js\nconsole.log('x')\n```");
  });
});

describe("closingFenceProtection (code blocks)", () => {
  const doc = "```js\nconsole.log('x')\n```";

  it("blocks deletion of code block closing fence line", () => {
    const state = createCodeBlockProtectedState(doc);
    const closingLine = state.doc.line(3);
    const tr = state.update({
      changes: { from: closingLine.from, to: closingLine.to, insert: "" },
    });
    // Transaction should be blocked — doc unchanged
    expect(tr.state.doc.toString()).toBe(doc);
  });

  it("allows whole-document deletion of a single code block", () => {
    const state = createCodeBlockProtectedState(doc);
    const tr = state.update({
      changes: { from: 0, to: doc.length, insert: "" },
    });
    expect(tr.state.doc.toString()).toBe("");
  });

  it("allows deletion from content through end of doc (boundary edge case)", () => {
    const state = createCodeBlockProtectedState(doc);
    const contentLine = state.doc.line(2);
    const tr = state.update({
      changes: { from: contentLine.from, to: doc.length, insert: "" },
    });
    expect(tr.state.doc.toString()).not.toBe(doc);
  });

  it("allows whole-block deletion spanning beyond fence in larger document", () => {
    const larger = "before\n```js\nconsole.log('x')\n```\nafter";
    const state = createCodeBlockProtectedState(larger);
    const tr = state.update({
      changes: { from: 0, to: larger.length, insert: "" },
    });
    expect(tr.state.doc.toString()).toBe("");
  });
});

describe("openingFenceDeletionCleanup (code blocks)", () => {
  const doc = "```js\nconsole.log('x')\n```";

  it("auto-removes closing fence when opening fence line is deleted", () => {
    const state = createCodeBlockProtectedState(doc);
    const openLine = state.doc.line(1);
    // Delete the full opening fence line (including newline)
    const tr = state.update({
      changes: { from: openLine.from, to: openLine.to + 1, insert: "" },
    });
    // Both fences removed, only content remains
    expect(tr.state.doc.toString()).toBe("console.log('x')");
  });

  it("auto-removes closing fence when opening fence content is deleted", () => {
    const state = createCodeBlockProtectedState(doc);
    const openLine = state.doc.line(1);
    // Delete just the opening fence content (not the newline)
    const tr = state.update({
      changes: { from: openLine.from, to: openLine.to, insert: "" },
    });
    // Closing fence should also be removed
    expect(tr.state.doc.toString()).not.toContain("```");
  });

  it("auto-removes closing fence when partial deletion breaks the backtick prefix (#766)", () => {
    const state = createCodeBlockProtectedState(doc);
    // Delete "```j" (positions 0-4); backtick protection allows because
    // the selection spans past the backtick prefix (atOrBeforeStart && pastBacktickEnd)
    const tr = state.update({
      changes: { from: 0, to: 4, insert: "" },
    });
    const result = tr.state.doc.toString();
    expect(result).not.toContain("```");
  });

  it("does not remove closing fence for partial opening fence edits", () => {
    const state = createCodeBlockProtectedState(doc);
    // Edit the language identifier, not the whole line
    // "```js" -> "```py" (replace "js" at position 3-5)
    const tr = state.update({
      changes: { from: 3, to: 5, insert: "py" },
    });
    const result = tr.state.doc.toString();
    expect(result).toContain("```py");
    // Closing fence still present
    expect(result.endsWith("```")).toBe(true);
  });

  it("preserves content between fences when opening fence is deleted", () => {
    const withContent = "before\n```js\nconsole.log('x')\n```\nafter";
    const state = createCodeBlockProtectedState(withContent);
    const openLine = state.doc.line(2);
    const tr = state.update({
      changes: { from: openLine.from, to: openLine.to + 1, insert: "" },
    });
    const result = tr.state.doc.toString();
    // Both fences removed, surrounding content preserved
    expect(result).toContain("before");
    expect(result).toContain("console.log('x')");
    expect(result).toContain("after");
    expect(result).not.toContain("```");
  });
});

// ---------------------------------------------------------------------------
// Display math protection (#777) — $$ and \[ delimiters
// ---------------------------------------------------------------------------

/**
 * Create a minimal EditorState for display math protection tests.
 * Needs the markdown parser with math extension and the semantics field
 * for math region extraction, plus the relevant protection filters.
 */
function createMathProtectedState(doc: string) {
  return createEditorState(doc, {
    extensions: [
      markdown({ extensions: markdownExtensions }),
      frontmatterField,
      documentSemanticsField,
      mathMacrosField,
      fenceProtectionExtension,
    ],
  });
}

describe("fenceProtection cache", () => {
  it("reuses closing-fence ranges across selection-only transactions", () => {
    const state = createProtectedState(`::: {.theorem}\ncontent\n:::`);
    const initialRanges = getClosingFenceRanges(state);
    expect(getClosingFenceRanges(state)).toBe(initialRanges);

    const afterSelection = state.update({ selection: { anchor: state.doc.length } }).state;
    expect(getClosingFenceRanges(afterSelection)).toBe(initialRanges);
  });

  it("reuses closing-fence ranges on non-structural code-block body edits", () => {
    const state = createCodeBlockProtectedState("```js\nconsole.log('x')\n```");
    const initialRanges = getClosingFenceRanges(state);

    const nextState = state.update({
      changes: { from: 6, to: 13, insert: "printer" },
    }).state;

    expect(nextState.doc.toString()).toContain("printer.log");
    expect(getClosingFenceRanges(nextState)).toBe(initialRanges);
  });

  it("invalidates backtick ranges when the opening fence marker changes with the same width", () => {
    const doc = "```js\nconsole.log('x')\n```";
    const state = createCodeBlockProtectedState(doc);
    const initialRanges = getOpeningFenceBacktickRanges(state);

    const nextState = state.update({
      changes: { from: 0, to: 3, insert: "~~~" },
      annotations: fenceOperationAnnotation.of(true),
    }).state;

    expect(nextState.doc.toString().startsWith("~~~js")).toBe(true);
    expect(getOpeningFenceBacktickRanges(nextState)).toEqual([]);
    expect(getOpeningFenceBacktickRanges(nextState)).not.toBe(initialRanges);
  });

  it("reuses math delimiter ranges on selection changes and non-delimiter edits", () => {
    const state = createMathProtectedState("$$\nx^2\n$$");
    const initialRanges = getOpeningMathDelimiterRanges(state);
    expect(getOpeningMathDelimiterRanges(state)).toBe(initialRanges);

    const afterSelection = state.update({ selection: { anchor: state.doc.length } }).state;
    expect(getOpeningMathDelimiterRanges(afterSelection)).toBe(initialRanges);

    const afterBodyEdit = afterSelection.update({
      changes: { from: 3, to: 6, insert: "x^3" },
    }).state;
    expect(getOpeningMathDelimiterRanges(afterBodyEdit)).toBe(initialRanges);

    const afterDelimiterEdit = afterBodyEdit.update({
      changes: { from: 0, to: 2, insert: "\\[" },
      annotations: fenceOperationAnnotation.of(true),
    }).state;
    expect(getOpeningMathDelimiterRanges(afterDelimiterEdit)).not.toBe(initialRanges);
  });
});

describe("openingFenceMathProtection ($$)", () => {
  const doc = "$$\nx^2\n$$";

  it("blocks partial deletion of opening $$ (single $)", () => {
    const state = createMathProtectedState(doc);
    const tr = state.update({ changes: { from: 0, to: 1, insert: "" } });
    expect(tr.state.doc.toString()).toBe(doc);
  });

  it("allows full delimiter deletion (cleanup removes closing too)", () => {
    // Unlike colons/backticks (which always have attrs after the prefix),
    // math delimiters ARE the entire line content. Deleting both $$ is
    // intentional and triggers cleanup of the closing $$.
    const state = createMathProtectedState(doc);
    const tr = state.update({ changes: { from: 0, to: 2, insert: "" } });
    expect(tr.state.doc.toString()).not.toContain("$$");
  });

  it("allows whole-block deletion spanning beyond fence", () => {
    const state = createMathProtectedState(doc);
    const tr = state.update({ changes: { from: 0, to: doc.length, insert: "" } });
    expect(tr.state.doc.toString()).toBe("");
  });

  it("allows edits with fenceOperationAnnotation bypass", () => {
    const state = createMathProtectedState(doc);
    const tr = state.update({
      changes: { from: 0, to: 2, insert: "\\[" },
      annotations: fenceOperationAnnotation.of(true),
    });
    expect(tr.state.doc.toString()).toBe("\\[\nx^2\n$$");
  });

  it("allows pure insertion at position 0 when block starts there", () => {
    const state = createMathProtectedState(doc);
    const tr = state.update({
      changes: { from: 0, to: 0, insert: "text\n" },
    });
    expect(tr.state.doc.toString()).toBe(`text\n${doc}`);
  });
});

describe("openingFenceMathProtection (\\[)", () => {
  const doc = "\\[\nx^2\n\\]";

  it("blocks partial deletion of opening \\[ (single char)", () => {
    const state = createMathProtectedState(doc);
    const tr = state.update({ changes: { from: 0, to: 1, insert: "" } });
    expect(tr.state.doc.toString()).toBe(doc);
  });

  it("allows full delimiter deletion (cleanup removes closing too)", () => {
    const state = createMathProtectedState(doc);
    const tr = state.update({ changes: { from: 0, to: 2, insert: "" } });
    expect(tr.state.doc.toString()).not.toContain("\\]");
  });

  it("allows whole-block deletion", () => {
    const state = createMathProtectedState(doc);
    const tr = state.update({ changes: { from: 0, to: doc.length, insert: "" } });
    expect(tr.state.doc.toString()).toBe("");
  });
});

describe("closingFenceProtection (display math $$)", () => {
  const doc = "$$\nx^2\n$$";

  it("blocks deletion of closing $$ line", () => {
    const state = createMathProtectedState(doc);
    const closingLine = state.doc.line(3);
    const tr = state.update({
      changes: { from: closingLine.from, to: closingLine.to, insert: "" },
    });
    expect(tr.state.doc.toString()).toBe(doc);
  });

  it("allows whole-block deletion spanning beyond fence", () => {
    const state = createMathProtectedState(doc);
    const tr = state.update({
      changes: { from: 0, to: doc.length, insert: "" },
    });
    expect(tr.state.doc.toString()).toBe("");
  });

  it("allows deletion from content through end of doc (boundary edge case)", () => {
    const state = createMathProtectedState(doc);
    const contentLine = state.doc.line(2);
    const tr = state.update({
      changes: { from: contentLine.from, to: doc.length, insert: "" },
    });
    expect(tr.state.doc.toString()).not.toBe(doc);
  });
});

describe("closingFenceProtection (display math \\[)", () => {
  const doc = "\\[\nx^2\n\\]";

  it("blocks deletion of closing \\] line", () => {
    const state = createMathProtectedState(doc);
    const closingLine = state.doc.line(3);
    const tr = state.update({
      changes: { from: closingLine.from, to: closingLine.to, insert: "" },
    });
    expect(tr.state.doc.toString()).toBe(doc);
  });

  it("allows whole-block deletion", () => {
    const state = createMathProtectedState(doc);
    const tr = state.update({
      changes: { from: 0, to: doc.length, insert: "" },
    });
    expect(tr.state.doc.toString()).toBe("");
  });
});

describe("openingFenceDeletionCleanup (display math $$)", () => {
  const doc = "$$\nx^2\n$$";

  it("auto-removes closing $$ when opening $$ line is deleted", () => {
    const state = createMathProtectedState(doc);
    const openLine = state.doc.line(1);
    const tr = state.update({
      changes: { from: openLine.from, to: openLine.to + 1, insert: "" },
    });
    expect(tr.state.doc.toString()).toBe("x^2");
  });

  it("auto-removes closing $$ when opening $$ content is deleted", () => {
    const state = createMathProtectedState(doc);
    const openLine = state.doc.line(1);
    const tr = state.update({
      changes: { from: openLine.from, to: openLine.to, insert: "" },
    });
    expect(tr.state.doc.toString()).not.toContain("$$");
  });

  it("preserves content between fences when opening is deleted", () => {
    const withContent = "before\n$$\nx^2 + y^2\n$$\nafter";
    const state = createMathProtectedState(withContent);
    const openLine = state.doc.line(2);
    const tr = state.update({
      changes: { from: openLine.from, to: openLine.to + 1, insert: "" },
    });
    const result = tr.state.doc.toString();
    expect(result).toContain("before");
    expect(result).toContain("x^2 + y^2");
    expect(result).toContain("after");
    expect(result).not.toContain("$$");
  });
});

describe("openingFenceDeletionCleanup (display math \\[)", () => {
  const doc = "\\[\nx^2\n\\]";

  it("auto-removes closing \\] when opening \\[ line is deleted", () => {
    const state = createMathProtectedState(doc);
    const openLine = state.doc.line(1);
    const tr = state.update({
      changes: { from: openLine.from, to: openLine.to + 1, insert: "" },
    });
    expect(tr.state.doc.toString()).toBe("x^2");
  });
});

// ---------------------------------------------------------------------------
// Empty math block backspace cleanup (#777) — paired entry undo
// ---------------------------------------------------------------------------

describe("emptyMathBlockBackspaceCleanup ($$)", () => {
  it("removes entire empty $$ block on backspace from blank content line", () => {
    // After pairedMathEntry: $$\n\n$$ with cursor at position 3 (start of blank line)
    // Backspace deletes the newline at position 2-3
    const doc = "$$\n\n$$";
    const state = createMathProtectedState(doc);
    const tr = state.update({ changes: { from: 2, to: 3, insert: "" } });
    expect(tr.state.doc.toString()).toBe("");
  });

  it("preserves surrounding content when removing empty $$ block", () => {
    const doc = "before\n$$\n\n$$\nafter";
    const state = createMathProtectedState(doc);
    // Line 2 "$$" ends at position 9; backspace from blank line 3 (position 10)
    const blankLine = state.doc.line(3);
    const openLine = state.doc.line(2);
    const tr = state.update({
      changes: { from: openLine.to, to: blankLine.from, insert: "" },
    });
    expect(tr.state.doc.toString()).toBe("before\nafter");
  });

  it("does not trigger for non-empty math block content", () => {
    const doc = "$$\nx^2\n$$";
    const state = createMathProtectedState(doc);
    // Backspace from start of content line "x^2" (position 3)
    const tr = state.update({ changes: { from: 2, to: 3, insert: "" } });
    // Content is not blank — cleanup should NOT trigger, just join lines
    expect(tr.state.doc.toString()).toBe("$$x^2\n$$");
  });

  it("does not trigger for multi-character deletions", () => {
    const doc = "$$\n\n$$";
    const state = createMathProtectedState(doc);
    // Deleting two characters (not a single-char backspace)
    const tr = state.update({ changes: { from: 1, to: 3, insert: "" } });
    // Should not expand to full block deletion
    expect(tr.state.doc.toString()).not.toBe("");
  });

  it("handles block with multiple blank lines between delimiters", () => {
    const doc = "$$\n\n\n$$";
    const state = createMathProtectedState(doc);
    // Backspace from the first blank line (position 3)
    const tr = state.update({ changes: { from: 2, to: 3, insert: "" } });
    expect(tr.state.doc.toString()).toBe("");
  });
});

describe("emptyMathBlockBackspaceCleanup (\\[)", () => {
  it("removes entire empty \\[ block on backspace from blank content line", () => {
    const doc = "\\[\n\n\\]";
    const state = createMathProtectedState(doc);
    const tr = state.update({ changes: { from: 2, to: 3, insert: "" } });
    expect(tr.state.doc.toString()).toBe("");
  });

  it("preserves surrounding content when removing empty \\[ block", () => {
    const doc = "before\n\\[\n\n\\]\nafter";
    const state = createMathProtectedState(doc);
    const blankLine = state.doc.line(3);
    const openLine = state.doc.line(2);
    const tr = state.update({
      changes: { from: openLine.to, to: blankLine.from, insert: "" },
    });
    expect(tr.state.doc.toString()).toBe("before\nafter");
  });
});
