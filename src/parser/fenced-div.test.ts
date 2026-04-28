import { parser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";

import { fencedDiv, findFencedDivOpenerTrailingContent } from "./fenced-div";
import { markdownExtensions } from "./index";
import { findNodeInfo, parseNodeInfos, parseNodeNames, type NodeInfo } from "../test-utils";

const fencedDivParser = parser.configure(fencedDiv);

/** Collect all node type names from parsing `text`. */
function nodeNames(text: string): string[] {
  return parseNodeNames(text, fencedDivParser);
}

/** Collect node info with positions from parsing `text`. */
function nodeInfos(text: string): NodeInfo[] {
  return parseNodeInfos(text, fencedDivParser);
}

/** Find the first node with a given name. Fails the test if not found. */
function findNode(infos: NodeInfo[], name: string): NodeInfo {
  return findNodeInfo(infos, name);
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

    it("rejects non-canonical trailing title text", () => {
      const text = "::: {.theorem} My Title\nContent.\n:::";
      const names = nodeNames(text);
      expect(names).not.toContain("FencedDiv");
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

  describe("non-canonical trailing titles", () => {
    it("rejects title text after closing brace", () => {
      const text = "::: {.theorem} Fundamental Theorem\nContent.\n:::";
      expect(nodeNames(text)).not.toContain("FencedDiv");
    });

    it("rejects title text after class shorthand", () => {
      const text = "::: Title Only\nContent.\n:::";
      expect(nodeNames(text)).not.toContain("FencedDiv");
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

    it("parses canonical 5/4/3-colon theorem-proof-blockquote nesting", () => {
      const text = [
        '::::: {.theorem title="Outer"}',
        "outside",
        ":::: {.proof}",
        "outer proof",
        "::: {.blockquote}",
        "quote inside",
        ":::",
        "back in proof",
        "::::",
        "back in theorem",
        ":::::",
      ].join("\n");
      const infos = nodeInfos(text);

      const divs = infos.filter((n) => n.name === "FencedDiv");
      expect(divs).toHaveLength(3);
      expect(divs.map((n) => n.text.split("\n")[0])).toEqual([
        '::::: {.theorem title="Outer"}',
        ":::: {.proof}",
        "::: {.blockquote}",
      ]);

      const attrs = infos.filter((n) => n.name === "FencedDivAttributes");
      expect(attrs.map((n) => n.text)).toEqual([
        '{.theorem title="Outer"}',
        "{.proof}",
        "{.blockquote}",
      ]);

      const fences = infos.filter((n) => n.name === "FencedDivFence");
      expect(fences.map((n) => n.text)).toEqual([
        ":::::",
        "::::",
        ":::",
        ":::",
        "::::",
        ":::::",
      ]);
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

  describe("short-form syntax", () => {
    it("creates FencedDiv for ::: Theorem", () => {
      const text = "::: Theorem\nContent.\n:::";
      const names = nodeNames(text);
      expect(names).toContain("FencedDiv");
    });

    it("creates FencedDivAttributes for the bare class name", () => {
      const text = "::: Theorem\nContent.\n:::";
      const infos = nodeInfos(text);
      const attr = findNode(infos, "FencedDivAttributes");
      expect(attr.text).toBe("Theorem");
    });

    it("rejects text after class name", () => {
      const text = "::: Theorem Main Result\nContent.\n:::";
      expect(nodeNames(text)).not.toContain("FencedDiv");
    });

    it("does not create FencedDivTitle when only class name", () => {
      const text = "::: Theorem\nContent.\n:::";
      const names = nodeNames(text);
      expect(names).not.toContain("FencedDivTitle");
    });

    it("parses content inside short-form div", () => {
      const text = "::: Theorem\nSome *emphasized* text.\n:::";
      const names = nodeNames(text);
      expect(names).toContain("Paragraph");
      expect(names).toContain("Emphasis");
    });

    it("supports nesting with short-form", () => {
      const text =
        ":::: Theorem\nSetup.\n::: Proof\nProof content.\n:::\n::::";
      const names = nodeNames(text);
      const divCount = names.filter((n) => n === "FencedDiv").length;
      expect(divCount).toBe(2);
    });

    it("handles short-form with trailing whitespace", () => {
      const text = "::: Theorem   \nContent.\n:::";
      const infos = nodeInfos(text);
      const attr = findNode(infos, "FencedDivAttributes");
      expect(attr.text).toBe("Theorem");
    });
  });

  describe("single-line syntax", () => {
    it("rejects single-line divs with braces", () => {
      const text = "::: {.theorem} Extreme Value Theorem :::";
      const names = nodeNames(text);
      expect(names).not.toContain("FencedDiv");
    });

    it("does not create fence nodes for self-closing forms", () => {
      const text = "::: {.theorem} Extreme Value Theorem :::";
      const names = nodeNames(text);
      const fenceCount = names.filter((n) => n === "FencedDivFence").length;
      expect(fenceCount).toBe(0);
    });

    it("does not capture attributes", () => {
      const text = "::: {.lemma} A continuous image is compact. :::";
      expect(nodeNames(text)).not.toContain("FencedDivAttributes");
    });

    it("does not capture title text", () => {
      const text = "::: {.theorem} Extreme Value Theorem :::";
      expect(nodeNames(text)).not.toContain("FencedDivTitle");
    });

    it("rejects short-form self-closing divs", () => {
      const text = "::: corollary Every bounded sequence converges. :::";
      expect(nodeNames(text)).not.toContain("FencedDiv");
    });

    it("keeps self-closing source as paragraph text", () => {
      const text = "::: {.theorem} Short theorem. :::\nNext paragraph.";
      const infos = nodeInfos(text);
      const paragraphs = infos.filter((n) => n.name === "Paragraph");
      expect(paragraphs.some((paragraph) => paragraph.text.includes("Short theorem"))).toBe(true);
      expect(paragraphs.some((paragraph) => paragraph.text.includes("Next paragraph"))).toBe(true);
    });

    it("rejects multiple single-line divs in sequence", () => {
      const text = "::: {.lemma} Lemma A. :::\n::: {.lemma} Lemma B. :::";
      const names = nodeNames(text);
      const divCount = names.filter((n) => n === "FencedDiv").length;
      expect(divCount).toBe(0);
    });

    it("rejects self-closing forms with more colons", () => {
      const text = "::::: {.theorem} Long fence theorem. :::::";
      const names = nodeNames(text);
      expect(names).not.toContain("FencedDiv");
      const fenceCount = names.filter((n) => n === "FencedDivFence").length;
      expect(fenceCount).toBe(0);
    });

    it("rejects empty self-closing forms", () => {
      const text = "::: {.theorem} :::";
      const names = nodeNames(text);
      expect(names).not.toContain("FencedDiv");
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

    it("sequential multi-line divs are separate blocks", () => {
      const text = "::: {.theorem}\nContent A\n:::\n\n::: {.proof}\nContent B\n:::";
      const infos = nodeInfos(text);
      const divs = infos.filter((n) => n.name === "FencedDiv");
      // Should be 2 separate FencedDiv blocks
      expect(divs.length).toBe(2);
      // First div should end at the first :::
      expect(divs[0].text).toBe("::: {.theorem}\nContent A\n:::");
      // Second div should be the proof
      expect(divs[1].text).toBe("::: {.proof}\nContent B\n:::");
      // Each should have 2 FencedDivFence children (opening + closing)
      for (const div of divs) {
        const fencesInDiv = infos.filter(
          (n) => n.name === "FencedDivFence" && n.from >= div.from && n.to <= div.to
        );
        expect(fencesInDiv.length, `div "${div.text.slice(0, 20)}" should have 2 fences`).toBe(2);
      }
    });

    it("sequential multi-line divs with full parser config", () => {
      // Use the same parser config as the editor to check for extension interference
      const fullParser = parser.configure(markdownExtensions);
      const text = "::: {.theorem}\nContent A\n:::\n\n::: {.proof}\nContent B\n:::";
      const tree = fullParser.parse(text);
      const divs: NodeInfo[] = [];
      tree.iterate({
        enter(node) {
          if (node.name === "FencedDiv") {
            divs.push({ name: node.name, from: node.from, to: node.to, text: text.slice(node.from, node.to) });
          }
        },
      });
      expect(divs.length, "should have 2 separate FencedDiv blocks").toBe(2);
      expect(divs[0].text).toBe("::: {.theorem}\nContent A\n:::");
      expect(divs[1].text).toBe("::: {.proof}\nContent B\n:::");
    });

    it("single $ inside fenced div does not break block boundaries", () => {
      // When $$ becomes $ (user deletes one $), the block should still close properly
      const fullParser = parser.configure(markdownExtensions);
      const text = [
        '::: {.theorem title="Title"}',
        "Content",
        "$",
        "\\sum_{k=1}^n k^2",
        "$$",
        ":::",
        "",
        "::: {.proof}",
        "Proof content",
        ":::",
      ].join("\n");
      const tree = fullParser.parse(text);
      const divs: NodeInfo[] = [];
      tree.iterate({
        enter(node) {
          if (node.name === "FencedDiv") {
            divs.push({ name: node.name, from: node.from, to: node.to, text: text.slice(node.from, node.to) });
          }
        },
      });
      expect(divs.length, `expected 2 divs but got ${divs.length}`).toBe(2);
    });

    it("unclosed display math inside a fenced div does not consume the closing fence", () => {
      const fullParser = parser.configure(markdownExtensions);
      const text = [
        "::: {.theorem}",
        "$$",
        "x^2",
        ":::",
        "",
        "::: {.proof}",
        "Proof content",
        ":::",
      ].join("\n");
      const tree = fullParser.parse(text);
      const divs: NodeInfo[] = [];
      tree.iterate({
        enter(node) {
          if (node.name === "FencedDiv") {
            divs.push({ name: node.name, from: node.from, to: node.to, text: text.slice(node.from, node.to) });
          }
        },
      });
      expect(divs.length, `expected 2 divs but got ${divs.length}`).toBe(2);
      expect(divs[0].text).toBe("::: {.theorem}\n$$\nx^2\n:::");
      expect(divs[1].text).toBe("::: {.proof}\nProof content\n:::");
    });

    it("same-colon nesting does not hide the second block boundary", () => {
      const fullParser = parser.configure(markdownExtensions);
      const text = [
        "::: {.theorem}",
        "::: {.proof}",
        "Proof content.",
        ":::",
        ":::",
      ].join("\n");
      const divs: NodeInfo[] = [];

      fullParser.parse(text).iterate({
        enter(node) {
          if (node.name === "FencedDiv") {
            divs.push({
              name: node.name,
              from: node.from,
              to: node.to,
              text: text.slice(node.from, node.to),
            });
          }
        },
      });

      expect(divs).toHaveLength(2);
      expect(divs[0].text).toBe("::: {.theorem}\n::: {.proof}\nProof content.\n:::");
      expect(divs[1].text).toBe("::: {.proof}\nProof content.");
    });

    it("sequential divs with display math before closing fence", () => {
      const fullParser = parser.configure(markdownExtensions);
      const text = [
        '::: {.theorem title="Fundamental Theorem"}',
        "For all $n \\in \\N$:",
        "$$",
        "\\sum_{k=1}^n k^2 = \\frac{n(n+1)(2n+1)}{6}",
        "$$",
        ":::",
        "",
        "::: {.proof}",
        "By induction.",
        ":::",
      ].join("\n");
      const tree = fullParser.parse(text);
      const divs: NodeInfo[] = [];
      tree.iterate({
        enter(node) {
          if (node.name === "FencedDiv") {
            divs.push({ name: node.name, from: node.from, to: node.to, text: text.slice(node.from, node.to) });
          }
        },
      });
      expect(divs.length, `got divs: ${divs.map(d => d.text.slice(0, 30)).join(" | ")}`).toBe(2);
    });

    it("text after document with div is parsed normally", () => {
      const text = "::: {.theorem}\nInside.\n:::\nOutside paragraph.";
      const infos = nodeInfos(text);
      const paragraphs = infos.filter((n) => n.name === "Paragraph");
      // One inside, one outside
      expect(paragraphs.length).toBe(2);
    });

    it("preserves an unmatched closing fence as paragraph source", () => {
      const text = "Before.\n:::\nAfter.";
      const infos = nodeInfos(text);
      expect(infos.filter((n) => n.name === "FencedDivFence")).toHaveLength(0);
      expect(infos.some((n) => n.name === "Paragraph" && n.text.includes(":::"))).toBe(true);
    });

    /**
     * REGRESSION GUARD: self-closing divs are non-canonical FORMAT.
     */
    it("self-closing div trailing colons do not create fenced divs", () => {
      const text = "::: {.theorem} EVT :::";
      expect(nodeNames(text)).not.toContain("FencedDiv");
    });

    it("self-closing div with many trailing colons is still rejected", () => {
      const text = "::::: {.lemma} Statement :::::";
      expect(nodeNames(text)).not.toContain("FencedDiv");
    });
  });

  describe("findFencedDivOpenerTrailingContent", () => {
    it("flags a second appended attribute block", () => {
      const text = '::: {.theorem} {#thm:squares title="Sum of squares"}';
      const trailing = findFencedDivOpenerTrailingContent(text);
      expect(trailing).toEqual({
        from: text.indexOf("{#"),
        to: text.length,
      });
    });

    it("flags a trailing title after a braced block", () => {
      const text = "::: {.theorem} Main result";
      const trailing = findFencedDivOpenerTrailingContent(text);
      expect(trailing).toEqual({
        from: text.indexOf("Main"),
        to: text.length,
      });
    });

    it("returns undefined for a canonical opener", () => {
      expect(
        findFencedDivOpenerTrailingContent('::: {.theorem #thm:1 title="x"}'),
      ).toBeUndefined();
    });

    it("returns undefined for a closing fence or unrelated text", () => {
      expect(findFencedDivOpenerTrailingContent(":::")).toBeUndefined();
      expect(findFencedDivOpenerTrailingContent("regular paragraph")).toBeUndefined();
    });
  });
});

describe("non-canonical Pandoc features", () => {
  it("does not enable Pandoc definition-list nodes", () => {
    const fullParser = parser.configure(markdownExtensions);
    const names = parseNodeNames("Term\n: Definition", fullParser);

    expect(names).not.toContain("DefinitionList");
    expect(names).not.toContain("Definition");
  });
});
