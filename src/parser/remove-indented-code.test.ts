import { parser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";

import { removeIndentedCode } from "./remove-indented-code";

/** Collect all node type names from parsing `text`. */
function nodeNames(text: string, configured = true): string[] {
  const p = configured ? parser.configure(removeIndentedCode) : parser;
  const tree = p.parse(text);
  const names: string[] = [];
  tree.iterate({
    enter: (node) => {
      names.push(node.name);
    },
  });
  return names;
}

describe("removeIndentedCode", () => {
  it("does not parse 4-space indented text as a code block", () => {
    const text = "    indented text here";
    const names = nodeNames(text);
    expect(names).not.toContain("IndentedCode");
    expect(names).not.toContain("CodeBlock");
    expect(names).toContain("Paragraph");
  });

  it("does not parse tab-indented text as a code block", () => {
    const text = "\tindented with tab";
    const names = nodeNames(text);
    expect(names).not.toContain("IndentedCode");
    expect(names).not.toContain("CodeBlock");
    expect(names).toContain("Paragraph");
  });

  it("does not parse multi-line indented text as a code block", () => {
    const text = "    line one\n    line two\n    line three";
    const names = nodeNames(text);
    expect(names).not.toContain("IndentedCode");
  });

  it("confirms default parser treats indented text as a code block", () => {
    const text = "    indented text here";
    const names = nodeNames(text, false);
    expect(names).toContain("CodeBlock");
    expect(names).not.toContain("Paragraph");
  });

  it("preserves fenced code blocks", () => {
    const text = "```typescript\nconst x = 1;\n```";
    const names = nodeNames(text);
    expect(names).toContain("FencedCode");
    expect(names).toContain("CodeInfo");
    expect(names).toContain("CodeMark");
  });

  it("preserves fenced code blocks with tilde syntax", () => {
    const text = "~~~\ncode here\n~~~";
    const names = nodeNames(text);
    expect(names).toContain("FencedCode");
  });

  it("preserves list items with indented continuation", () => {
    const text = "- first item\n  continuation of first item\n- second item";
    const names = nodeNames(text);
    expect(names).toContain("BulletList");
    expect(names).toContain("ListItem");
    expect(names).not.toContain("IndentedCode");
  });

  it("preserves ordered list items with indented content", () => {
    const text = "1. first item\n   continuation line\n2. second item";
    const names = nodeNames(text);
    expect(names).toContain("OrderedList");
    expect(names).toContain("ListItem");
    expect(names).not.toContain("IndentedCode");
  });

  it("treats deeply indented text after a paragraph as a paragraph", () => {
    const text = "A paragraph.\n\n        deeply indented text";
    const names = nodeNames(text);
    expect(names).not.toContain("IndentedCode");
  });
});
