import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { containerAttributesField } from "./container-attributes";

/** Create an EditorState with the markdown parser and containerAttributesField. */
function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown(), containerAttributesField],
  });
}

/** Extract (lineStart, tagName) pairs from the field's DecorationSet. */
function extractTags(state: EditorState): Array<{ pos: number; tag: string }> {
  const decos = state.field(containerAttributesField);
  const result: Array<{ pos: number; tag: string }> = [];
  const iter = decos.iter();
  while (iter.value) {
    const attrs = (iter.value as Decoration & { spec?: { attributes?: Record<string, string> } })
      .spec?.attributes;
    const tag = attrs?.["data-tag-name"];
    if (tag) {
      result.push({ pos: iter.from, tag });
    }
    iter.next();
  }
  return result;
}

/** Extract just the tag names in document order. */
function extractTagNames(state: EditorState): string[] {
  return extractTags(state).map((t) => t.tag);
}

describe("containerAttributesField", () => {
  describe("headings", () => {
    it("decorates h1 through h6", () => {
      const doc = [
        "# H1",
        "## H2",
        "### H3",
        "#### H4",
        "##### H5",
        "###### H6",
      ].join("\n");
      expect(extractTagNames(createState(doc))).toEqual([
        "h1", "h2", "h3", "h4", "h5", "h6",
      ]);
    });

    it("places decoration at line start for a heading", () => {
      const doc = "# Title";
      const tags = extractTags(createState(doc));
      expect(tags).toEqual([{ pos: 0, tag: "h1" }]);
    });

    it("places h2 decoration at correct offset", () => {
      const doc = "# First\n## Second";
      const tags = extractTags(createState(doc));
      expect(tags).toEqual([
        { pos: 0, tag: "h1" },
        { pos: 8, tag: "h2" },
      ]);
    });
  });

  describe("paragraphs", () => {
    it("decorates a single paragraph", () => {
      const doc = "Hello world";
      expect(extractTagNames(createState(doc))).toEqual(["p"]);
    });

    it("decorates multiple paragraphs separated by blank lines", () => {
      const doc = "First paragraph.\n\nSecond paragraph.";
      expect(extractTagNames(createState(doc))).toEqual(["p", "p"]);
    });

    it("decorates each line of a multi-line paragraph as p", () => {
      const doc = "Line one\nLine two\nLine three";
      const tags = extractTags(createState(doc));
      expect(tags).toEqual([
        { pos: 0, tag: "p" },
        { pos: 9, tag: "p" },
        { pos: 18, tag: "p" },
      ]);
    });
  });

  describe("lists", () => {
    it("tags bullet list lines as p (innermost Paragraph wins over BulletList)", () => {
      const doc = "- item one\n- item two";
      const tags = extractTagNames(createState(doc));
      // Lezer produces BulletList > ListItem > Paragraph; depth-first means Paragraph overwrites.
      expect(tags).toEqual(["p", "p"]);
    });

    it("tags ordered list lines as p (innermost Paragraph wins over OrderedList)", () => {
      const doc = "1. first\n2. second";
      const tags = extractTagNames(createState(doc));
      expect(tags).toEqual(["p", "p"]);
    });
  });

  describe("mixed content", () => {
    it("decorates headings, paragraphs, and lists in a mixed document", () => {
      const doc = [
        "# Title",
        "",
        "A paragraph.",
        "",
        "- bullet",
      ].join("\n");
      const tags = extractTagNames(createState(doc));
      expect(tags).toEqual(["h1", "p", "p"]);
    });
  });

  describe("horizontal rule", () => {
    it("decorates a horizontal rule as hr", () => {
      const doc = "Above\n\n---\n\nBelow";
      const tags = extractTagNames(createState(doc));
      expect(tags).toContain("hr");
    });
  });

  describe("fenced code", () => {
    it("decorates fenced code block lines as code", () => {
      const doc = "```\nlet x = 1;\n```";
      const tags = extractTagNames(createState(doc));
      expect(tags).toContain("code");
    });
  });

  describe("empty document", () => {
    it("returns no decorations for an empty document", () => {
      expect(extractTags(createState(""))).toEqual([]);
    });
  });

  describe("update on doc change", () => {
    it("recomputes decorations when document changes", () => {
      const state = createState("# Hello");
      expect(extractTagNames(state)).toEqual(["h1"]);

      const newState = state.update({
        changes: { from: 0, to: state.doc.length, insert: "Plain text" },
      }).state;
      expect(extractTagNames(newState)).toEqual(["p"]);
    });
  });

  describe("mapOnDocChanged (#718)", () => {
    it("decoration positions remain correct after text insertion", () => {
      const state = createState("# Title\n\nParagraph text");
      const before = extractTags(state);
      expect(before).toEqual([
        { pos: 0, tag: "h1" },
        { pos: 9, tag: "p" },
      ]);

      // Insert text within the paragraph — shifts paragraph content
      // but doesn't change block structure
      const edited = state.update({
        changes: { from: 9, insert: "More " },
      }).state;
      const after = extractTags(edited);

      expect(after[0]).toEqual({ pos: 0, tag: "h1" });
      expect(after[1].tag).toBe("p");
      expect(after[1].pos).toBe(9); // paragraph starts at same line
    });

    it("decoration positions remain correct after text deletion", () => {
      const state = createState("# Title\n\nParagraph");
      const before = extractTags(state);
      expect(before.length).toBe(2);

      // Delete the blank line between heading and paragraph
      const edited = state.update({
        changes: { from: 8, to: 9 },
      }).state;
      const after = extractTags(edited);

      // All decorations should reference valid line positions
      for (const t of after) {
        const line = edited.doc.lineAt(t.pos);
        expect(line.from).toBe(t.pos);
      }
    });
  });
});
