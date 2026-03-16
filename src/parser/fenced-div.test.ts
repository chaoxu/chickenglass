import { parser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";

import { fencedDiv } from "./fenced-div";

const fencedDivParser = parser.configure(fencedDiv);

/** Collect all node type names from parsing `text`. */
function nodeNames(text: string): string[] {
  const tree = fencedDivParser.parse(text);
  const names: string[] = [];
  tree.iterate({
    enter: (node) => {
      names.push(node.name);
    },
  });
  return names;
}

interface NodeInfo {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

/** Collect node info with positions from parsing `text`. */
function nodeInfos(text: string): NodeInfo[] {
  const tree = fencedDivParser.parse(text);
  const infos: NodeInfo[] = [];
  tree.iterate({
    enter: (node) => {
      infos.push({
        name: node.name,
        from: node.from,
        to: node.to,
        text: text.slice(node.from, node.to),
      });
    },
  });
  return infos;
}

/** Find the first node with a given name. Fails the test if not found. */
function findNode(infos: NodeInfo[], name: string): NodeInfo {
  const node = infos.find((n) => n.name === name);
  expect(node, `expected to find node "${name}"`).toBeDefined();
  // After the assertion above, node is guaranteed to be defined.
  // Use a conditional return to satisfy strict null checks without non-null assertion.
  if (!node) throw new Error(`unreachable: node "${name}" not found`);
  return node;
}

describe("fenced div parser", () => {
  describe("basic parsing", () => {
    it("creates FencedDiv node for basic div", () => {
      const text = "::: {.theorem}\nContent here.\n:::";
      const names = nodeNames(text);
      expect(names).toContain("FencedDiv");
    });

    it("creates FencedDivFence nodes for opening and closing fences", () => {
      const text = "::: {.theorem}\nContent.\n:::";
      const names = nodeNames(text);
      const fenceCount = names.filter((n) => n === "FencedDivFence").length;
      expect(fenceCount).toBe(2);
    });

    it("creates FencedDivAttributes node", () => {
      const text = "::: {.theorem}\nContent.\n:::";
      const names = nodeNames(text);
      expect(names).toContain("FencedDivAttributes");
    });

    it("creates FencedDivTitle node when title is present", () => {
      const text = "::: {.theorem} My Title\nContent.\n:::";
      const names = nodeNames(text);
      expect(names).toContain("FencedDivTitle");
    });

    it("does not create FencedDivTitle when no title", () => {
      const text = "::: {.theorem}\nContent.\n:::";
      const names = nodeNames(text);
      expect(names).not.toContain("FencedDivTitle");
    });
  });

  describe("attributes", () => {
    it("captures attribute text with braces", () => {
      const text = "::: {.theorem #thm-1}\nContent.\n:::";
      const infos = nodeInfos(text);
      const attr = findNode(infos, "FencedDivAttributes");
      expect(attr.text).toBe("{.theorem #thm-1}");
    });

    it("captures class-only attributes", () => {
      const text = "::: {.proof}\nQED.\n:::";
      const infos = nodeInfos(text);
      const attr = findNode(infos, "FencedDivAttributes");
      expect(attr.text).toBe("{.proof}");
    });

    it("captures attributes with key-value pairs", () => {
      const text = "::: {.theorem #thm counter=theorem}\nContent.\n:::";
      const infos = nodeInfos(text);
      const attr = findNode(infos, "FencedDivAttributes");
      expect(attr.text).toBe("{.theorem #thm counter=theorem}");
    });
  });

  describe("title", () => {
    it("captures title text after closing brace", () => {
      const text = "::: {.theorem} Fundamental Theorem\nContent.\n:::";
      const infos = nodeInfos(text);
      const title = findNode(infos, "FencedDivTitle");
      expect(title.text).toBe("Fundamental Theorem");
    });

    it("captures title without attributes", () => {
      const text = "::: Title Only\nContent.\n:::";
      const infos = nodeInfos(text);
      const title = findNode(infos, "FencedDivTitle");
      expect(title.text).toBe("Title Only");
    });
  });

  describe("content parsing", () => {
    it("parses content as markdown paragraphs", () => {
      const text = "::: {.theorem}\nA paragraph inside.\n:::";
      const names = nodeNames(text);
      expect(names).toContain("Paragraph");
    });

    it("parses content with emphasis", () => {
      const text = "::: {.theorem}\nSome *emphasized* text.\n:::";
      const names = nodeNames(text);
      expect(names).toContain("Emphasis");
    });

    it("parses content with multiple paragraphs", () => {
      const text =
        "::: {.theorem}\nFirst paragraph.\n\nSecond paragraph.\n:::";
      const names = nodeNames(text);
      const paragraphCount = names.filter((n) => n === "Paragraph").length;
      expect(paragraphCount).toBe(2);
    });

    it("parses content with headings", () => {
      const text = "::: {.section}\n# A Heading\nContent.\n:::";
      const names = nodeNames(text);
      expect(names).toContain("ATXHeading1");
    });

    it("parses content with lists", () => {
      const text = "::: {.example}\n- item 1\n- item 2\n:::";
      const names = nodeNames(text);
      expect(names).toContain("BulletList");
      expect(names).toContain("ListItem");
    });
  });

  describe("nesting", () => {
    it("supports nested divs with more colons", () => {
      const text =
        ":::: {.theorem}\nSetup.\n::: {.proof}\nProof content.\n:::\n::::";
      const names = nodeNames(text);
      const divCount = names.filter((n) => n === "FencedDiv").length;
      expect(divCount).toBe(2);
    });

    it("inner div has its own attributes", () => {
      const text = ":::: {.theorem}\n::: {.proof}\nContent.\n:::\n::::";
      const infos = nodeInfos(text);
      const attrs = infos.filter((n) => n.name === "FencedDivAttributes");
      expect(attrs.length).toBe(2);
      expect(attrs[0].text).toBe("{.theorem}");
      expect(attrs[1].text).toBe("{.proof}");
    });

    it("deeply nested divs work", () => {
      const text =
        ":::::: {.outer}\n:::: {.middle}\n::: {.inner}\nDeep.\n:::\n::::\n::::::";
      const names = nodeNames(text);
      const divCount = names.filter((n) => n === "FencedDiv").length;
      expect(divCount).toBe(3);
    });

    it("closing fence matches by colon count", () => {
      const text =
        ":::: {.outer}\nBefore.\n::: {.inner}\nInner.\n:::\nAfter.\n::::";
      const names = nodeNames(text);
      const divCount = names.filter((n) => n === "FencedDiv").length;
      expect(divCount).toBe(2);
    });
  });

  describe("fence detection", () => {
    it("requires at least 3 colons", () => {
      const text = ":: {.not-a-div}\nContent.\n::";
      const names = nodeNames(text);
      expect(names).not.toContain("FencedDiv");
    });

    it("works with exactly 3 colons", () => {
      const text = "::: {.theorem}\nContent.\n:::";
      const names = nodeNames(text);
      expect(names).toContain("FencedDiv");
    });

    it("works with many colons", () => {
      const text = "::::::: {.theorem}\nContent.\n:::::::";
      const names = nodeNames(text);
      expect(names).toContain("FencedDiv");
    });

    it("closing fence needs at least as many colons as opening", () => {
      // 5-colon opening should not be closed by 3-colon fence
      const text =
        "::::: {.outer}\n::: {.inner}\nContent.\n:::\nMore.\n:::::";
      const names = nodeNames(text);
      const divCount = names.filter((n) => n === "FencedDiv").length;
      expect(divCount).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("unclosed div extends to end of document", () => {
      const text = "::: {.theorem}\nContent without closing fence.";
      const names = nodeNames(text);
      expect(names).toContain("FencedDiv");
      expect(names).toContain("Paragraph");
    });

    it("empty div with no content", () => {
      const text = "::: {.theorem}\n:::";
      const names = nodeNames(text);
      expect(names).toContain("FencedDiv");
      const fenceCount = names.filter((n) => n === "FencedDivFence").length;
      expect(fenceCount).toBe(2);
    });

    it("div does not interfere with fenced code blocks", () => {
      const text =
        "::: {.example}\n```typescript\nconst x = 1;\n```\n:::";
      const names = nodeNames(text);
      expect(names).toContain("FencedDiv");
      expect(names).toContain("FencedCode");
    });

    it("text after document with div is parsed normally", () => {
      const text = "::: {.theorem}\nInside.\n:::\nOutside paragraph.";
      const infos = nodeInfos(text);
      const paragraphs = infos.filter((n) => n.name === "Paragraph");
      // One inside, one outside
      expect(paragraphs.length).toBe(2);
    });
  });
});
