import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { frontmatterDecoration, frontmatterField } from "./frontmatter-state";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [frontmatterField, frontmatterDecoration],
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

  it("parses math macros", () => {
    const doc = "---\nmath:\n  \\R: \\mathbb{R}\n---\nContent";
    const state = createState(doc);
    const fm = state.field(frontmatterField);
    expect(fm.config.math).toEqual({ "\\R": "\\mathbb{R}" });
  });
});

describe("frontmatterDecoration", () => {
  it("creates decoration hiding frontmatter", () => {
    const doc = "---\ntitle: Hello\n---\nContent";
    const state = createState(doc);
    const decos = state.field(frontmatterDecoration);
    // Should have exactly one decoration range
    const iter = decos.iter();
    expect(iter.value).not.toBeNull();
    expect(iter.from).toBe(0);
    expect(iter.to).toBe(state.field(frontmatterField).end);
  });

  it("creates no decorations when no frontmatter", () => {
    const state = createState("# No frontmatter");
    const decos = state.field(frontmatterDecoration);
    const iter = decos.iter();
    expect(iter.value).toBeNull();
  });
});
