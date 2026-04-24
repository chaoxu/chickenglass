import { describe, expect, it } from "vitest";

import {
  parseMarkdownFragmentToJSON,
  serializeBlockToMarkdown,
} from "./headless-markdown-parse";

describe("parseMarkdownFragmentToJSON", () => {
  it("returns one empty paragraph for empty input", () => {
    // Lexical's root always normalizes to at least one paragraph; the
    // adapter splices this in to produce a clean empty paragraph when
    // the user clears the source entirely.
    const blocks = parseMarkdownFragmentToJSON("");
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { type: string }).type).toBe("paragraph");
  });

  it("parses a single paragraph into one paragraph block", () => {
    const blocks = parseMarkdownFragmentToJSON("hello *world*");
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { type: string }).type).toBe("paragraph");
  });

  it("parses a heading-prefixed source into a heading block", () => {
    const blocks = parseMarkdownFragmentToJSON("# A heading");
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { type: string }).type).toBe("heading");
  });

  it("splits multi-block markdown into multiple top-level blocks", () => {
    const blocks = parseMarkdownFragmentToJSON("first paragraph\n\nsecond paragraph");
    expect(blocks).toHaveLength(2);
    expect((blocks[0] as { type: string }).type).toBe("paragraph");
    expect((blocks[1] as { type: string }).type).toBe("paragraph");
  });

  it("reuses the pooled editor across calls without leaking state", () => {
    parseMarkdownFragmentToJSON("first call");
    const blocks = parseMarkdownFragmentToJSON("second call only");
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { type: string }).type).toBe("paragraph");
  });

  it("resets pooled state between parse and serialize calls", () => {
    parseMarkdownFragmentToJSON("# stale heading");
    const [block] = parseMarkdownFragmentToJSON("fresh paragraph");
    expect(block).toBeDefined();

    expect(serializeBlockToMarkdown(block).trim()).toBe("fresh paragraph");
  });
});

describe("serializeBlockToMarkdown", () => {
  it("round-trips a paragraph with inline formatting", () => {
    const [block] = parseMarkdownFragmentToJSON("hello *italic* and **bold**");
    expect(block).toBeDefined();
    const markdown = serializeBlockToMarkdown(block);
    expect(markdown.trim()).toBe("hello *italic* and **bold**");
  });

  it("round-trips a heading", () => {
    const [block] = parseMarkdownFragmentToJSON("## A heading");
    expect(block).toBeDefined();
    const markdown = serializeBlockToMarkdown(block);
    expect(markdown.trim()).toBe("## A heading");
  });

  it("round-trips a heading with Pandoc attributes", () => {
    const [block] = parseMarkdownFragmentToJSON("## A heading {#sec:a-heading}");
    expect(block).toBeDefined();
    const markdown = serializeBlockToMarkdown(block);
    expect(markdown.trim()).toBe("## A heading {#sec:a-heading}");
  });

  it("exports imported quotes as canonical fenced blockquotes", () => {
    const [block] = parseMarkdownFragmentToJSON("> a quote");
    expect(block).toBeDefined();
    const markdown = serializeBlockToMarkdown(block);
    expect(markdown.trim()).toBe([
      "::: {.blockquote}",
      "a quote",
      ":::",
    ].join("\n"));
  });
});
