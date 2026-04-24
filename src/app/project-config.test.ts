import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";

import { frontmatterField } from "../editor/frontmatter-state";
import type { FrontmatterConfig } from "../parser/frontmatter";
import { MemoryFileSystem } from "./file-manager";
import {
  loadProjectConfig,
  loadProjectConfigWithStatus,
  mergeConfigs,
  parseProjectConfig,
  parseProjectConfigWithStatus,
  projectConfigFacet,
  PROJECT_CONFIG_FILE,
  type ProjectConfig,
} from "./project-config";

// ---------------------------------------------------------------------------
// Type-level test: ProjectConfig = Omit<FrontmatterConfig, "title">.
// These assignments will fail to compile if the relationship breaks.
// ---------------------------------------------------------------------------
const _fmAsProject: ProjectConfig = {} as Omit<FrontmatterConfig, "title">;
const _projectAsFm: Omit<FrontmatterConfig, "title"> = {} as ProjectConfig;
void _fmAsProject;
void _projectAsFm;

// ---------------------------------------------------------------------------
// parseProjectConfig
// ---------------------------------------------------------------------------

describe("parseProjectConfig", () => {
  it("parses math macros", () => {
    const yaml = "math:\n  \\R: \\mathbb{R}\n  \\N: \\mathbb{N}";
    const config = parseProjectConfig(yaml);
    expect(config.math).toEqual({
      "\\R": "\\mathbb{R}",
      "\\N": "\\mathbb{N}",
    });
  });

  it("parses bibliography and csl", () => {
    const yaml = "bibliography: refs.bib\ncsl: ieee.csl";
    const config = parseProjectConfig(yaml);
    expect(config.bibliography).toBe("refs.bib");
    expect(config.csl).toBe("ieee.csl");
  });

  it("parses block definitions", () => {
    const yaml = [
      "blocks:",
      "  theorem: true",
      "  claim:",
      "    counter: theorem",
      "    numbered: true",
      "    title: Claim",
    ].join("\n");
    const config = parseProjectConfig(yaml);
    expect(config.blocks).toEqual({
      theorem: true,
      claim: { counter: "theorem", numbered: true, title: "Claim" },
    });
  });

  it("ignores title field", () => {
    const yaml = "title: Should Be Ignored\nbibliography: refs.bib";
    const config = parseProjectConfig(yaml);
    expect((config as Record<string, unknown>)["title"]).toBeUndefined();
    expect(config.bibliography).toBe("refs.bib");
  });

  it("parses numbering scheme", () => {
    const yaml = "numbering: global";
    const config = parseProjectConfig(yaml);
    expect(config.numbering).toBe("global");
  });

  it("parses numbering grouped scheme", () => {
    const yaml = "numbering: grouped";
    const config = parseProjectConfig(yaml);
    expect(config.numbering).toBe("grouped");
  });

  it("ignores invalid numbering value", () => {
    const yaml = "numbering: invalid";
    const config = parseProjectConfig(yaml);
    expect(config.numbering).toBeUndefined();
  });

  it("returns empty config for empty input", () => {
    const config = parseProjectConfig("");
    expect(config).toEqual({});
  });

  it("returns empty config for comments-only input", () => {
    const config = parseProjectConfig("# just a comment\n# another");
    expect(config).toEqual({});
  });

  it("parses double-quoted YAML values with backslash escapes", () => {
    const yaml = 'math:\n  \\set: "\\\\left\\\\{#1\\\\right\\\\}"';
    const config = parseProjectConfig(yaml);
    expect(config.math).toEqual({
      "\\set": "\\left\\{#1\\right\\}",
    });
  });

  it("parses non-builtin macros with arguments", () => {
    const yaml = [
      "math:",
      '  \\e: "\\\\varepsilon"',
      '  \\bm: "\\\\boldsymbol{#1}"',
      '  \\ceil: "\\\\left\\\\lceil#1\\\\right\\\\rceil"',
    ].join("\n");
    const config = parseProjectConfig(yaml);
    expect(config.math).toEqual({
      "\\e": "\\varepsilon",
      "\\bm": "\\boldsymbol{#1}",
      "\\ceil": "\\left\\lceil#1\\right\\rceil",
    });
  });

  it("parses mix of unquoted and double-quoted macro values", () => {
    const yaml = [
      "math:",
      "  \\R: \\mathbb{R}",
      '  \\set: "\\\\left\\\\{#1\\\\right\\\\}"',
    ].join("\n");
    const config = parseProjectConfig(yaml);
    expect(config.math).toEqual({
      "\\R": "\\mathbb{R}",
      "\\set": "\\left\\{#1\\right\\}",
    });
  });

  it("returns structured parse status for invalid YAML", () => {
    const result = parseProjectConfigWithStatus("bibliography: [");
    expect(result.config).toEqual({});
    expect(result.status).toEqual(expect.objectContaining({
      state: "error",
      path: PROJECT_CONFIG_FILE,
      kind: "parse",
    }));
  });
});

// ---------------------------------------------------------------------------
// mergeConfigs
// ---------------------------------------------------------------------------

describe("mergeConfigs", () => {
  it("file title is preserved, project has no title", () => {
    const merged = mergeConfigs({}, { title: "My Doc" });
    expect(merged.title).toBe("My Doc");
  });

  it("file bibliography overrides project", () => {
    const merged = mergeConfigs(
      { bibliography: "project.bib" },
      { bibliography: "local.bib" },
    );
    expect(merged.bibliography).toBe("local.bib");
  });

  it("project bibliography used when file has none", () => {
    const merged = mergeConfigs({ bibliography: "project.bib" }, {});
    expect(merged.bibliography).toBe("project.bib");
  });

  it("file csl overrides project", () => {
    const merged = mergeConfigs({ csl: "project.csl" }, { csl: "local.csl" });
    expect(merged.csl).toBe("local.csl");
  });

  it("project csl used when file has none", () => {
    const merged = mergeConfigs({ csl: "project.csl" }, {});
    expect(merged.csl).toBe("project.csl");
  });

  it("math macros are merged additively", () => {
    const merged = mergeConfigs(
      { math: { "\\R": "\\mathbb{R}", "\\N": "\\mathbb{N}" } },
      { math: { "\\R": "\\mathcal{R}", "\\Z": "\\mathbb{Z}" } },
    );
    expect(merged.math).toEqual({
      "\\R": "\\mathcal{R}", // file overrides
      "\\N": "\\mathbb{N}", // project preserved
      "\\Z": "\\mathbb{Z}", // file added
    });
  });

  it("project-only math macros are inherited", () => {
    const merged = mergeConfigs(
      { math: { "\\R": "\\mathbb{R}" } },
      {},
    );
    expect(merged.math).toEqual({ "\\R": "\\mathbb{R}" });
  });

  it("file-only math macros work without project", () => {
    const merged = mergeConfigs(
      {},
      { math: { "\\R": "\\mathbb{R}" } },
    );
    expect(merged.math).toEqual({ "\\R": "\\mathbb{R}" });
  });

  it("blocks are merged additively", () => {
    const merged = mergeConfigs(
      { blocks: { theorem: true, lemma: true } },
      { blocks: { lemma: false, claim: { counter: "theorem", numbered: true } } },
    );
    expect(merged.blocks).toEqual({
      theorem: true,        // project preserved
      lemma: false,         // file overrides (disable)
      claim: { counter: "theorem", numbered: true }, // file added
    });
  });

  it("file numbering overrides project", () => {
    const merged = mergeConfigs(
      { numbering: "grouped" },
      { numbering: "global" },
    );
    expect(merged.numbering).toBe("global");
  });

  it("project numbering used when file has none", () => {
    const merged = mergeConfigs({ numbering: "global" }, {});
    expect(merged.numbering).toBe("global");
  });

  it("no numbering when neither side provides it", () => {
    const merged = mergeConfigs({}, {});
    expect(merged.numbering).toBeUndefined();
  });

  it("returns empty config when both are empty", () => {
    const merged = mergeConfigs({}, {});
    expect(merged).toEqual({});
  });

  it("no math/blocks keys when neither side provides them", () => {
    const merged = mergeConfigs(
      { bibliography: "a.bib" },
      { title: "T" },
    );
    expect(merged.math).toBeUndefined();
    expect(merged.blocks).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// loadProjectConfig
// ---------------------------------------------------------------------------

describe("loadProjectConfig", () => {
  it("loads config from coflat.yaml", async () => {
    const fs = new MemoryFileSystem({
      [PROJECT_CONFIG_FILE]: "bibliography: refs.bib\nmath:\n  \\R: \\mathbb{R}",
    });
    const config = await loadProjectConfig(fs);
    expect(config.bibliography).toBe("refs.bib");
    expect(config.math).toEqual({ "\\R": "\\mathbb{R}" });
  });

  it("returns empty config when file does not exist", async () => {
    const fs = new MemoryFileSystem({});
    const config = await loadProjectConfig(fs);
    expect(config).toEqual({});
  });

  it("loads non-builtin macros with double-quoted YAML values", async () => {
    const yaml = [
      "math:",
      "  \\R: \\mathbb{R}",
      '  \\set: "\\\\left\\\\{#1\\\\right\\\\}"',
      '  \\e: "\\\\varepsilon"',
    ].join("\n");
    const fs = new MemoryFileSystem({ [PROJECT_CONFIG_FILE]: yaml });
    const config = await loadProjectConfig(fs);
    expect(config.math).toEqual({
      "\\R": "\\mathbb{R}",
      "\\set": "\\left\\{#1\\right\\}",
      "\\e": "\\varepsilon",
    });
  });

  it("returns structured missing status when config file does not exist", async () => {
    const fs = new MemoryFileSystem({});
    const result = await loadProjectConfigWithStatus(fs);
    expect(result).toEqual({
      config: {},
      status: { state: "missing", path: PROJECT_CONFIG_FILE },
    });
  });

  it("returns structured read status when config file cannot be read", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fs = {
      exists: async () => true,
      readFile: async () => {
        throw new Error("permission denied");
      },
    } as unknown as MemoryFileSystem;

    const result = await loadProjectConfigWithStatus(fs);

    expect(result.config).toEqual({});
    expect(result.status).toEqual({
      state: "error",
      path: PROJECT_CONFIG_FILE,
      kind: "read",
      message: "permission denied",
    });
    consoleWarn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// projectConfigFacet integration with frontmatterField
// ---------------------------------------------------------------------------

describe("projectConfigFacet", () => {
  it("provides project config to frontmatterField via facet", () => {
    const doc = "---\ntitle: My Doc\n---\nContent";
    const projectConfig = {
      bibliography: "project.bib",
      math: { "\\R": "\\mathbb{R}" },
    };

    const state = EditorState.create({
      doc,
      extensions: [
        projectConfigFacet.of(projectConfig),
        frontmatterField,
      ],
    });

    const fm = state.field(frontmatterField);
    // Title comes from file
    expect(fm.config.title).toBe("My Doc");
    // Bibliography comes from project (file has none)
    expect(fm.config.bibliography).toBe("project.bib");
    // Math comes from project
    expect(fm.config.math).toEqual({ "\\R": "\\mathbb{R}" });
  });

  it("file frontmatter overrides project config", () => {
    const doc = "---\nbibliography: local.bib\nmath:\n  \\R: \\mathcal{R}\n---\nContent";
    const projectConfig = {
      bibliography: "project.bib",
      math: { "\\R": "\\mathbb{R}", "\\N": "\\mathbb{N}" },
    };

    const state = EditorState.create({
      doc,
      extensions: [
        projectConfigFacet.of(projectConfig),
        frontmatterField,
      ],
    });

    const fm = state.field(frontmatterField);
    expect(fm.config.bibliography).toBe("local.bib");
    expect(fm.config.math).toEqual({
      "\\R": "\\mathcal{R}",  // file overrides
      "\\N": "\\mathbb{N}",   // project inherited
    });
  });

  it("works without project config facet", () => {
    const doc = "---\ntitle: Solo\n---\nContent";
    const state = EditorState.create({
      doc,
      extensions: [frontmatterField],
    });

    const fm = state.field(frontmatterField);
    expect(fm.config.title).toBe("Solo");
    expect(fm.config.bibliography).toBeUndefined();
  });

  it("provides non-builtin macros with arguments via project config", () => {
    const doc = "---\ntitle: Test\n---\nContent";
    const projectConfig = {
      math: {
        "\\e": "\\varepsilon",
        "\\set": "\\left\\{#1\\right\\}",
        "\\bm": "\\boldsymbol{#1}",
      },
    };

    const state = EditorState.create({
      doc,
      extensions: [
        projectConfigFacet.of(projectConfig),
        frontmatterField,
      ],
    });

    const fm = state.field(frontmatterField);
    expect(fm.config.math).toEqual({
      "\\e": "\\varepsilon",
      "\\set": "\\left\\{#1\\right\\}",
      "\\bm": "\\boldsymbol{#1}",
    });
  });

  it("file macros override project non-builtin macros", () => {
    const doc = "---\nmath:\n  \\e: \\epsilon\n---\nContent";
    const projectConfig = {
      math: {
        "\\e": "\\varepsilon",
        "\\set": "\\left\\{#1\\right\\}",
      },
    };

    const state = EditorState.create({
      doc,
      extensions: [
        projectConfigFacet.of(projectConfig),
        frontmatterField,
      ],
    });

    const fm = state.field(frontmatterField);
    expect(fm.config.math).toEqual({
      "\\e": "\\epsilon",              // file overrides project
      "\\set": "\\left\\{#1\\right\\}", // project preserved
    });
  });

  it("merges project blocks with file blocks", () => {
    const doc = [
      "---",
      "blocks:",
      "  lemma: false",
      "  claim:",
      "    counter: theorem",
      "    numbered: true",
      "---",
      "Content",
    ].join("\n");
    const projectConfig = {
      blocks: { theorem: true, lemma: true },
    };

    const state = EditorState.create({
      doc,
      extensions: [
        projectConfigFacet.of(projectConfig),
        frontmatterField,
      ],
    });

    const fm = state.field(frontmatterField);
    expect(fm.config.blocks).toEqual({
      theorem: true,
      lemma: false,
      claim: { counter: "theorem", numbered: true },
    });
  });
});
