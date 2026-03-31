/**
 * Unit tests for fence protection transaction filters.
 *
 * Tests the closing fence protection, opening fence colon protection,
 * and opening fence deletion cleanup filters that prevent accidental
 * structural damage to fenced divs and fenced code blocks in rich mode.
 *
 * Moved from plugin-render.test.ts during fence-protection extraction (#433).
 * Unified to cover both fenced divs and code blocks (#441).
 */

import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { markdownExtensions } from "../parser";
import {
  fenceOperationAnnotation,
  openingFenceDeletionCleanup,
  closingFenceProtection,
  openingFenceColonProtection,
  openingFenceBacktickProtection,
} from "./fence-protection";
import { _blockDecorationFieldForTest as blockDecorationField } from "./plugin-render";
import { createPluginRegistryField } from "./plugin-registry";
import { blockCounterField } from "./block-counter";
import { documentSemanticsField } from "../semantics/codemirror-source";
import { editorFocusField, mathMacrosField } from "../render/render-core";
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
      openingFenceDeletionCleanup,
      closingFenceProtection,
      openingFenceColonProtection,
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
      openingFenceDeletionCleanup,
      closingFenceProtection,
      openingFenceBacktickProtection,
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
