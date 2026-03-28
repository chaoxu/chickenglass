import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { frontmatterField } from "./frontmatter-state";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [frontmatterField],
  });
}

describe("frontmatterField", () => {
  it("parses frontmatter on creation", () => {
    const state = createState(
      "---\ntitle: Hello\nbibliography: ref.bib\n---\nContent",
    );
    const fm = state.field(frontmatterField);
    expect(fm.config.title).toBe("Hello");
    expect(fm.config.bibliography).toBe("ref.bib");
    expect(fm.end).toBeGreaterThan(0);
  });

  it("returns empty config when no frontmatter", () => {
    const state = createState("# No frontmatter\nJust content.");
    const fm = state.field(frontmatterField);
    expect(fm.config).toEqual({});
    expect(fm.end).toBe(-1);
  });

  it("updates when frontmatter is modified", () => {
    const state = createState("---\ntitle: Hello\n---\nContent");
    const fm1 = state.field(frontmatterField);
    expect(fm1.config.title).toBe("Hello");

    // Replace "Hello" with "World" (at position 11..16)
    const tr = state.update({
      changes: { from: 11, to: 16, insert: "World" },
    });
    const fm2 = tr.state.field(frontmatterField);
    expect(fm2.config.title).toBe("World");
  });

  it("does not re-parse when change is after frontmatter", () => {
    const doc = "---\ntitle: Hello\n---\nContent here";
    const state = createState(doc);
    const fm1 = state.field(frontmatterField);

    // Append text after frontmatter
    const tr = state.update({
      changes: { from: doc.length, insert: " more text" },
    });
    const fm2 = tr.state.field(frontmatterField);
    // Should be the exact same object (no re-parse)
    expect(fm2).toBe(fm1);
  });

  it("re-parses when frontmatter is added to a document without one", () => {
    const state = createState("# Heading\nContent");
    const fm1 = state.field(frontmatterField);
    expect(fm1.end).toBe(-1);

    // Insert frontmatter at the start
    const tr = state.update({
      changes: { from: 0, to: 0, insert: "---\ntitle: New\n---\n" },
    });
    const fm2 = tr.state.field(frontmatterField);
    expect(fm2.config.title).toBe("New");
    expect(fm2.end).toBeGreaterThan(0);
  });

  it("parses blocks config", () => {
    const doc = [
      "---",
      "blocks:",
      "  theorem: true",
      "  claim:",
      "    counter: theorem",
      "    numbered: true",
      "    title: Claim",
      "---",
      "Content",
    ].join("\n");
    const state = createState(doc);
    const fm = state.field(frontmatterField);
    const blocks = fm.config.blocks ?? {};
    expect(blocks["theorem"]).toBe(true);
    expect(blocks["claim"]).toEqual({
      counter: "theorem",
      numbered: true,
      title: "Claim",
    });
  });

  it("keeps blocksRevision stable when unrelated frontmatter keys change", () => {
    const originalDoc = [
      "---",
      "title: Hello",
      "blocks:",
      "  theorem: true",
      "---",
      "Content",
    ].join("\n");
    const nextDoc = originalDoc.replace("Hello", "World");
    const state = createState(originalDoc);
    const fm1 = state.field(frontmatterField);

    const tr = state.update({
      changes: { from: 0, to: originalDoc.length, insert: nextDoc },
    });
    const fm2 = tr.state.field(frontmatterField);

    expect(fm2.blocksRevision).toBe(fm1.blocksRevision);
  });

  it("increments blocksRevision when blocks config changes", () => {
    const originalDoc = [
      "---",
      "title: Hello",
      "blocks:",
      "  theorem: true",
      "---",
      "Content",
    ].join("\n");
    const nextDoc = originalDoc.replace("theorem: true", "theorem: false");
    const state = createState(originalDoc);
    const fm1 = state.field(frontmatterField);

    const tr = state.update({
      changes: { from: 0, to: originalDoc.length, insert: nextDoc },
    });
    const fm2 = tr.state.field(frontmatterField);

    expect(fm2.blocksRevision).toBe(fm1.blocksRevision + 1);
  });

  // Regression: inserting closing --- after an opening --- must be detected.
  // Issue #494 — when end===-1 and doc starts with ---, edits after position 0
  // were skipped because the old check only tested fromA === 0.
  it("detects closing delimiter insertion when doc starts with --- (issue #494)", () => {
    // Start with an unclosed frontmatter block
    const doc = "---\ntitle: Hello\n";
    const state = createState(doc);
    expect(state.field(frontmatterField).end).toBe(-1);

    // Insert closing --- at the end (position > 0)
    const tr = state.update({
      changes: { from: doc.length, insert: "---\nContent" },
    });
    const fm = tr.state.field(frontmatterField);
    expect(fm.config.title).toBe("Hello");
    expect(fm.end).toBeGreaterThan(0);
  });

  it("detects closing delimiter typed character by character (issue #494)", () => {
    // Simulate typing the closing --- one character at a time.
    // Note: `---` at EOF (no trailing newline) IS a valid closing delimiter
    // per extractRawFrontmatter, so frontmatter is detected after the third `-`.
    let state = createState("---\ntitle: Test\n");
    expect(state.field(frontmatterField).end).toBe(-1);

    // Type '-'
    state = state.update({
      changes: { from: state.doc.length, insert: "-" },
    }).state;
    expect(state.field(frontmatterField).end).toBe(-1);

    // Type '-'
    state = state.update({
      changes: { from: state.doc.length, insert: "-" },
    }).state;
    expect(state.field(frontmatterField).end).toBe(-1);

    // Type '-' — now doc is "---\ntitle: Test\n---" which is valid frontmatter
    state = state.update({
      changes: { from: state.doc.length, insert: "-" },
    }).state;
    const fm = state.field(frontmatterField);
    expect(fm.config.title).toBe("Test");
    expect(fm.end).toBeGreaterThan(0);
  });

  it("does not false-positive re-parse when doc does not start with ---", () => {
    const state = createState("No frontmatter here\nSecond line");
    expect(state.field(frontmatterField).end).toBe(-1);

    // Append text after --- somewhere — should not trigger false positive
    const tr = state.update({
      changes: { from: state.doc.length, insert: "\n---" },
    });
    expect(tr.state.field(frontmatterField).end).toBe(-1);
  });

  it("parses math macros", () => {
    const doc = "---\nmath:\n  \\R: \\mathbb{R}\n---\nContent";
    const state = createState(doc);
    const fm = state.field(frontmatterField);
    expect(fm.config.math).toEqual({ "\\R": "\\mathbb{R}" });
  });

  it("parses frontmatter when the closing delimiter falls after 4 KB", () => {
    const longValue = "x".repeat(5000);
    const doc = `---\ntitle: Large\nsummary: ${longValue}\n---\nContent`;
    const state = createState(doc);
    const fm = state.field(frontmatterField);

    expect(fm.config.title).toBe("Large");
    expect(fm.end).toBeGreaterThan(4096);
  });
});

