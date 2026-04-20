import { describe, expect, it } from "vitest";
import { createHeadlessEditor } from "@lexical/headless";
import { $getRoot, ParagraphNode, TextNode } from "lexical";
import { HeadingNode, $createHeadingNode } from "@lexical/rich-text";
import { readLexicalTree } from "./tree-print";

function createTestEditor(namespace = "test-editor") {
  return createHeadlessEditor({
    namespace,
    nodes: [ParagraphNode, TextNode, HeadingNode],
    onError(error) {
      throw error;
    },
  });
}

describe("readLexicalTree", () => {
  it("prints root with namespace", () => {
    const editor = createTestEditor("my-namespace");
    const tree = readLexicalTree(editor);
    expect(tree).toContain('(root) "my-namespace"');
  });

  it("prints paragraph and text nodes", () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const p = new ParagraphNode();
        p.append(new TextNode("hello world"));
        root.append(p);
      },
      { discrete: true },
    );
    const tree = readLexicalTree(editor);
    expect(tree).toContain("(paragraph)");
    expect(tree).toContain("(text)");
    expect(tree).toContain('"hello world"');
  });

  it("prints heading nodes with correct type", () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const h1 = $createHeadingNode("h1");
        h1.append(new TextNode("Title"));
        root.append(h1);

        const h2 = $createHeadingNode("h2");
        h2.append(new TextNode("Subtitle"));
        root.append(h2);
      },
      { discrete: true },
    );
    const tree = readLexicalTree(editor);
    expect(tree).toContain("(heading)");
    expect(tree).toContain('"Title"');
    expect(tree).toContain('"Subtitle"');
  });

  it("includes selection when present", () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const p = new ParagraphNode();
        const text = new TextNode("hello");
        p.append(text);
        root.append(p);
        text.select(0, 3);
      },
      { discrete: true },
    );
    const tree = readLexicalTree(editor);
    expect(tree).toContain("selection:");
  });

  it("handles nested structure (heading followed by paragraph)", () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();

        const h1 = $createHeadingNode("h1");
        h1.append(new TextNode("Section"));
        root.append(h1);

        const p = new ParagraphNode();
        p.append(new TextNode("Body text"));
        root.append(p);
      },
      { discrete: true },
    );

    const tree = readLexicalTree(editor);
    const lines = tree.split("\n");

    expect(lines[0]).toContain("(root)");
    expect(lines.some((l) => l.includes("(heading)"))).toBe(true);
    expect(lines.some((l) => l.includes("(paragraph)"))).toBe(true);
    expect(lines.some((l) => l.includes('"Section"'))).toBe(true);
    expect(lines.some((l) => l.includes('"Body text"'))).toBe(true);
  });
});
