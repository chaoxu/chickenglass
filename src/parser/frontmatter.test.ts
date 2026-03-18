import { describe, expect, it } from "vitest";

import {
  extractRawFrontmatter,
  parseFrontmatter,
} from "./frontmatter";

describe("extractRawFrontmatter", () => {
  it("extracts YAML between --- delimiters", () => {
    const doc = "---\ntitle: Hello\n---\nBody text";
    const result = extractRawFrontmatter(doc);
    expect(result).not.toBeNull();
    expect(result?.raw).toBe("title: Hello");
    expect(result?.end).toBe(21); // right after "---\n"
  });

  it("returns null when no frontmatter present", () => {
    const doc = "# Just a heading\nSome text";
    expect(extractRawFrontmatter(doc)).toBeNull();
  });

  it("returns null when opening --- has trailing text", () => {
    const doc = "--- bad\ntitle: Hello\n---\n";
    expect(extractRawFrontmatter(doc)).toBeNull();
  });

  it("returns null when no closing delimiter", () => {
    const doc = "---\ntitle: Hello\n";
    expect(extractRawFrontmatter(doc)).toBeNull();
  });

  it("handles frontmatter at end of document without trailing newline", () => {
    const doc = "---\ntitle: Hello\n---";
    const result = extractRawFrontmatter(doc);
    expect(result).not.toBeNull();
    expect(result?.raw).toBe("title: Hello");
    expect(result?.end).toBe(20);
  });
});

describe("parseFrontmatter", () => {
  it("parses title field", () => {
    const doc = "---\ntitle: My Document\n---\n";
    const { config, end } = parseFrontmatter(doc);
    expect(config.title).toBe("My Document");
    expect(end).toBeGreaterThan(0);
  });

  it("parses bibliography field", () => {
    const doc = "---\nbibliography: ref.bib\n---\n";
    const { config } = parseFrontmatter(doc);
    expect(config.bibliography).toBe("ref.bib");
  });

  it("parses quoted values", () => {
    const doc = '---\ntitle: "My Document"\n---\n';
    const { config } = parseFrontmatter(doc);
    expect(config.title).toBe("My Document");
  });

  it("parses single-quoted values", () => {
    const doc = "---\ntitle: 'My Document'\n---\n";
    const { config } = parseFrontmatter(doc);
    expect(config.title).toBe("My Document");
  });

  it("parses math macros", () => {
    const doc = "---\nmath:\n  \\R: \\mathbb{R}\n  \\N: \\mathbb{N}\n---\n";
    const { config } = parseFrontmatter(doc);
    expect(config.math).toEqual({
      "\\R": "\\mathbb{R}",
      "\\N": "\\mathbb{N}",
    });
  });

  it("parses simple block booleans", () => {
    const doc = "---\nblocks:\n  theorem: true\n  proof: true\n---\n";
    const { config } = parseFrontmatter(doc);
    expect(config.blocks).toBeDefined();
    const blocks = config.blocks ?? {};
    expect(blocks["theorem"]).toBe(true);
    expect(blocks["proof"]).toBe(true);
  });

  it("parses nested block config", () => {
    const doc = [
      "---",
      "blocks:",
      "  theorem: true",
      "  claim:",
      "    counter: theorem",
      "    numbered: true",
      "    title: Claim",
      "---",
      "",
    ].join("\n");
    const { config } = parseFrontmatter(doc);
    expect(config.blocks).toBeDefined();
    const blocks = config.blocks ?? {};
    expect(blocks["theorem"]).toBe(true);
    expect(blocks["claim"]).toEqual({
      counter: "theorem",
      numbered: true,
      title: "Claim",
    });
  });

  it("parses full frontmatter example", () => {
    const doc = [
      "---",
      "title: My Document",
      "bibliography: ref.bib",
      "blocks:",
      "  theorem: true",
      "  claim:",
      "    counter: theorem",
      "    numbered: true",
      "    title: Claim",
      "math:",
      "  \\R: \\mathbb{R}",
      "---",
      "",
      "# Content starts here",
    ].join("\n");
    const { config, end } = parseFrontmatter(doc);
    expect(config.title).toBe("My Document");
    expect(config.bibliography).toBe("ref.bib");
    const blocks = config.blocks ?? {};
    expect(blocks["theorem"]).toBe(true);
    expect(blocks["claim"]).toEqual({
      counter: "theorem",
      numbered: true,
      title: "Claim",
    });
    expect(config.math).toEqual({ "\\R": "\\mathbb{R}" });
    expect(end).toBeGreaterThan(0);
    expect(doc.slice(end)).toBe("\n# Content starts here");
  });

  it("returns empty config when no frontmatter", () => {
    const doc = "# Just content\nNo frontmatter here.";
    const { config, end } = parseFrontmatter(doc);
    expect(config).toEqual({});
    expect(end).toBe(-1);
  });

  it("handles empty frontmatter", () => {
    const doc = "---\n---\nContent";
    const { config, end } = parseFrontmatter(doc);
    expect(config).toEqual({});
    expect(end).toBeGreaterThan(0);
  });

  it("handles frontmatter with only comments", () => {
    const doc = "---\n# This is a comment\n---\n";
    const { config } = parseFrontmatter(doc);
    expect(config).toEqual({});
  });

  it("handles block with false value", () => {
    const doc = "---\nblocks:\n  theorem: false\n---\n";
    const { config } = parseFrontmatter(doc);
    const blocks = config.blocks ?? {};
    expect(blocks["theorem"]).toBe(false);
  });

  it("ignores unknown top-level keys", () => {
    const doc = "---\ntitle: Hello\nunknown_key: something\n---\n";
    const { config } = parseFrontmatter(doc);
    expect(config.title).toBe("Hello");
    // unknown_key is not in the typed config
    expect(
      (config as Record<string, unknown>)["unknown_key"],
    ).toBeUndefined();
  });

  it("parses numbering: global", () => {
    const doc = "---\nnumbering: global\n---\n";
    const { config } = parseFrontmatter(doc);
    expect(config.numbering).toBe("global");
  });

  it("parses numbering: grouped", () => {
    const doc = "---\nnumbering: grouped\n---\n";
    const { config } = parseFrontmatter(doc);
    expect(config.numbering).toBe("grouped");
  });

  it("ignores invalid numbering values", () => {
    const doc = "---\nnumbering: invalid\n---\n";
    const { config } = parseFrontmatter(doc);
    expect(config.numbering).toBeUndefined();
  });

  it("parses numbering alongside other fields", () => {
    const doc = [
      "---",
      "title: Blog Post",
      "numbering: global",
      "blocks:",
      "  theorem: true",
      "---",
      "",
    ].join("\n");
    const { config } = parseFrontmatter(doc);
    expect(config.title).toBe("Blog Post");
    expect(config.numbering).toBe("global");
    expect(config.blocks?.["theorem"]).toBe(true);
  });
});
