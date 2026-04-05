import { describe, expect, it, vi } from "vitest";

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

  it("does not treat a line with trailing text as the closing delimiter", () => {
    const doc = "---\ntitle: Hello\n--- not closing\nstill yaml-ish\n---\nBody";
    const result = extractRawFrontmatter(doc);
    expect(result).not.toBeNull();
    expect(result?.raw).toBe("title: Hello\n--- not closing\nstill yaml-ish");
    expect(doc.slice(result?.end ?? 0)).toBe("Body");
  });

  it("consumes the full CRLF closing line before the body", () => {
    const doc = "---\r\ntitle: Hello\r\n---\r\nBody";
    const result = extractRawFrontmatter(doc);
    expect(result).not.toBeNull();
    expect(doc.slice(result?.end ?? 0)).toBe("Body");
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

  it("parses image-folder from frontmatter", () => {
    const doc = "---\nimage-folder: assets\n---\n";
    const { config } = parseFrontmatter(doc);
    expect(config.imageFolder).toBe("assets");
  });

  it("parses imageFolder (camelCase) from frontmatter", () => {
    const doc = "---\nimageFolder: img\n---\n";
    const { config } = parseFrontmatter(doc);
    expect(config.imageFolder).toBe("img");
  });

  it("parses image-folder alongside other fields", () => {
    const doc = [
      "---",
      "title: My Doc",
      "image-folder: images",
      "bibliography: refs.bib",
      "---",
      "",
    ].join("\n");
    const { config } = parseFrontmatter(doc);
    expect(config.title).toBe("My Doc");
    expect(config.imageFolder).toBe("images");
    expect(config.bibliography).toBe("refs.bib");
  });

  it("parses quoted image-folder value", () => {
    const doc = '---\nimage-folder: "my assets"\n---\n';
    const { config } = parseFrontmatter(doc);
    expect(config.imageFolder).toBe("my assets");
  });

  /**
   * REGRESSION (#411): quoted math macro keys were misparsed by the custom
   * YAML parser. `'\\F': '\\mathcal{F}'` yielded key `'\\F'` (with quotes)
   * instead of `\\F`. Fixed by replacing the custom parser with the standard
   * `yaml` npm package.
   */
  describe("quoted math macro keys (REGRESSION #411: custom parser misparsed)", () => {
    it("parses single-quoted math macro keys", () => {
      // In YAML single-quoted strings, backslash is literal (no escape sequences).
      // So '\\F' in YAML means the two-char string: backslash + F → `\F`.
      // In the JS test string, we need `\\` to represent one backslash in the output.
      const doc = [
        "---",
        "math:",
        "  '\\F': '\\mathcal{F}'",
        "  '\\G': '\\mathcal{G}'",
        "---",
        "",
      ].join("\n");
      const { config } = parseFrontmatter(doc);
      expect(config.math).toEqual({
        "\\F": "\\mathcal{F}",
        "\\G": "\\mathcal{G}",
      });
    });

    it("parses double-quoted math macro keys", () => {
      // In YAML double-quoted strings, `\\` is an escape for a single backslash.
      // So "\\R" in YAML means `\R`.
      const doc = [
        "---",
        "math:",
        '  "\\\\R": "\\\\mathbb{R}"',
        '  "\\\\N": "\\\\mathbb{N}"',
        "---",
        "",
      ].join("\n");
      const { config } = parseFrontmatter(doc);
      expect(config.math).toEqual({
        "\\R": "\\mathbb{R}",
        "\\N": "\\mathbb{N}",
      });
    });

    it("parses mixed quoted and unquoted math macro keys", () => {
      const doc = [
        "---",
        "math:",
        "  \\R: \\mathbb{R}",
        "  '\\F': '\\mathcal{F}'",
        "---",
        "",
      ].join("\n");
      const { config } = parseFrontmatter(doc);
      expect(config.math).toBeDefined();
      expect(config.math?.["\\R"]).toBe("\\mathbb{R}");
      expect(config.math?.["\\F"]).toBe("\\mathcal{F}");
    });
  });

  /**
   * REGRESSION: invalid `blocks:` scalars must not be accepted as enabled.
   *
   * Non-boolean scalars are invalid for `blocks:` entries. Parsing them as
   * `true` unexpectedly overrides built-in or project-level plugin settings.
   * The parser should warn and ignore the invalid entry instead.
   */
  describe("non-boolean block values (REGRESSION: invalid scalar coercion)", () => {
    it("ignores non-boolean scalar and warns", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const doc = "---\nblocks:\n  theorem: yes\n---\n";
      const { config } = parseFrontmatter(doc);
      expect(config.blocks?.["theorem"]).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("expected boolean or mapping"),
      );
      warnSpy.mockRestore();
    });

    it("keeps valid entries while ignoring invalid ones", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const doc = "---\nblocks:\n  theorem: true\n  proof: enabled\n---\n";
      const { config } = parseFrontmatter(doc);
      expect(config.blocks?.["theorem"]).toBe(true);
      expect(config.blocks?.["proof"]).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("does not warn for actual boolean values", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const doc = "---\nblocks:\n  theorem: true\n  proof: false\n---\n";
      parseFrontmatter(doc);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
