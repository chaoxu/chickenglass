import { describe, expect, it } from "vitest";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  LexicalEditor,
  ParagraphNode,
  TextNode,
} from "lexical";
import { HeadingNode, $createHeadingNode } from "@lexical/rich-text";

/**
 * Inline copy of readLexicalTree since we test the debug bridge output,
 * not the React panel rendering.
 */
function $printNode(node: import("lexical").LexicalNode, indent: number): string {
  const prefix = "  ".repeat(indent);
  const type = node.getType();
  const key = node.getKey();
  let line = `${prefix}(${type}) ${JSON.stringify(key)}`;

  if ("__text" in node && typeof (node as Record<string, unknown>).__text === "string") {
    const text = (node as Record<string, unknown>).__text as string;
    line += ` ${JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}...` : text)}`;
  }

  const children =
    "getChildren" in node && typeof node.getChildren === "function"
      ? (node.getChildren as () => import("lexical").LexicalNode[])()
      : [];

  const childLines = children.map((child: import("lexical").LexicalNode) =>
    $printNode(child, indent + 1),
  );
  return [line, ...childLines].join("\n");
}

function readLexicalTree(editor: LexicalEditor): string {
  let result = "";
  editor.read(() => {
    const root = $getRoot();
    const selection = $getSelection();
    const lines: string[] = [];
    lines.push(`(root) "${editor._config.namespace}"`);
    for (const child of root.getChildren()) {
      lines.push($printNode(child, 1));
    }
    if ($isRangeSelection(selection)) {
      lines.push(
        `\nselection: anchor=${selection.anchor.key}:${selection.anchor.offset} focus=${selection.focus.key}:${selection.focus.offset}`,
      );
    }
    result = lines.join("\n");
  });
  return result;
}

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
