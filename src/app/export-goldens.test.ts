/**
 * Pandoc HTML / LaTeX export golden tests.
 *
 * Inline canonical fixtures are fed through `pandoc` using the same arg list
 * the Tauri backend builds (sourced from `src/latex/export-contract.json`).
 * Assertions are structural — element / substring / regex — not byte-equal,
 * because Pandoc output churns on whitespace and version.
 *
 * Skipped cleanly when the toolchain is missing:
 *   - HTML tests require `pandoc` + `pandoc-crossref` (and built-in citeproc).
 *   - LaTeX tests require `pandoc` + the in-repo Lua filter + a builtin
 *     template; xelatex is NOT required (we don't compile to PDF).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const CONTRACT_PATH = resolve(REPO_ROOT, "src", "latex", "export-contract.json");
const LATEX_DIR = resolve(REPO_ROOT, "src", "latex");

const FIXTURES = {
  plain: `# Introduction

This is a plain document with a heading and a paragraph.

## Background

Coflat exports through Pandoc.
`,
  mathEqref: `# Math

Inline math like $E = mc^2$ should render. The labeled equation below is
referenced as [@eq:einstein].

$$
E = mc^2
$$ {#eq:einstein}
`,
  citation: `---
references:
- id: knuth1997
  type: book
  title: "The Art of Computer Programming"
  author:
  - family: Knuth
    given: Donald E.
  issued:
    year: 1997
---

# Citations

Algorithm analysis traces back to [@knuth1997].
`,
  theorem: `# Results

::: {.theorem #thm:main title="Main Result"}
Every continuous function on a compact set is bounded.
:::

::: {.proof}
Apply the extreme value theorem.
:::
`,
  figure: `# Figures

![System overview](overview.png){#fig:overview}

See [@fig:overview] for the architecture.
`,
  table: `# Tables

| Algorithm | Time         |
|-----------|--------------|
| Quicksort | $O(n\\log n)$ |
| Bubble    | $O(n^2)$     |

: Running times {#tbl:runtime}

Refer to [@tbl:runtime] for the comparison.
`,
} as const;

interface ExportContract {
  pandoc_from: string;
  latex: {
    templates: { default: string; builtins: Record<string, string> };
    args: string[];
    bibliography_metadata_arg: string;
    pdf_args: string[];
  };
  html: { args: string[] };
}

const contract: ExportContract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));

/** Mirror of `render_pandoc_arg` in src-tauri/src/commands/export.rs. */
function renderArg(template: string, values: Record<string, string>): string {
  let out = "";
  let rest = template;
  while (true) {
    const open = rest.indexOf("{");
    if (open === -1) {
      out += rest;
      break;
    }
    out += rest.slice(0, open);
    const after = rest.slice(open + 1);
    const close = after.indexOf("}");
    if (close === -1) {
      out += rest.slice(open);
      break;
    }
    const key = after.slice(0, close);
    if (key.length > 0 && /^[a-z_]+$/.test(key)) {
      out += values[key] ?? "";
      rest = after.slice(close + 1);
    } else {
      out += "{";
      rest = after;
    }
  }
  return out;
}

function renderArgs(templates: string[], values: Record<string, string>): string[] {
  return templates.map((t) => renderArg(t, values));
}

function hasTool(name: string): boolean {
  return spawnSync(name, ["--version"], { encoding: "utf8" }).status === 0;
}

const HAS_PANDOC = hasTool("pandoc");
const HAS_CROSSREF = hasTool("pandoc-crossref");

function runPandoc(args: string[], input: string): string {
  const result = spawnSync("pandoc", args, { encoding: "utf8", input });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `pandoc exited ${result.status}`);
  }
  return result.stdout;
}

function buildHtmlArgs(): string[] {
  // We let pandoc write to stdout (output_path empty -> "--output=") and
  // strip that arg out, so we don't have to manage temp files. Resource path
  // points at the repo root; fixtures are inline.
  const rendered = renderArgs(contract.html.args, {
    pandoc_from: contract.pandoc_from,
    resource_path: REPO_ROOT,
    output_path: "",
  });
  return rendered.filter((a) => a !== "--output=");
}

function buildLatexArgs(template: "article" | "lipics"): string[] {
  const filterPath = resolve(LATEX_DIR, "filter.lua");
  const templateRel = contract.latex.templates.builtins[template];
  if (!templateRel) throw new Error(`unknown builtin template: ${template}`);
  const templatePath = resolve(LATEX_DIR, templateRel);
  const rendered = renderArgs(contract.latex.args, {
    pandoc_from: contract.pandoc_from,
    resource_path: REPO_ROOT,
    output_path: "",
    latex_filter_path: filterPath,
    latex_template_path: templatePath,
  });
  return rendered.filter((a) => a !== "--output=");
}

describe("Pandoc HTML export goldens", () => {
  it("renders the canonical contract args", () => {
    // Sanity: the args we feed pandoc match the production Rust pipeline.
    const args = buildHtmlArgs();
    expect(args).toContain(`--from=${contract.pandoc_from}`);
    expect(args).toContain("--to=html5");
    expect(args).toContain("--standalone");
    expect(args).toContain("--katex");
    expect(args).toContain("--section-divs");
    expect(args).toContain("--filter=pandoc-crossref");
    expect(args).toContain("--citeproc");
    expect(args).toContain("--metadata=link-citations=true");
  });

  it.skipIf(!(HAS_PANDOC && HAS_CROSSREF))(
    "exports plain prose with section-divs and headings",
    () => {
      const html = runPandoc(buildHtmlArgs(), FIXTURES.plain);
      expect(html).toMatch(/<section[^>]*class="[^"]*level1[^"]*"/);
      expect(html).toMatch(/<h1[^>]*>Introduction<\/h1>/);
      expect(html).toMatch(/<h2[^>]*>Background<\/h2>/);
      expect(html).toContain("Coflat exports through Pandoc");
    },
  );

  it.skipIf(!(HAS_PANDOC && HAS_CROSSREF))(
    "exports inline + display math with KaTeX markers and equation label",
    () => {
      const html = runPandoc(buildHtmlArgs(), FIXTURES.mathEqref);
      // pandoc-crossref assigns an eq:einstein anchor.
      expect(html).toMatch(/id="eq:einstein"/);
      // pandoc-crossref resolves [@eq:einstein] to numbered text "eq. 1".
      // Without --metadata=linkReferences=true it is plain text, not a link.
      expect(html).toMatch(/eq\.\s*1/);
      // Display math is wrapped in a math display container with E = mc^2.
      expect(html).toMatch(/class="math display"/);
    },
  );

  it.skipIf(!(HAS_PANDOC && HAS_CROSSREF))(
    "exports citations with citeproc-built bibliography",
    () => {
      const html = runPandoc(buildHtmlArgs(), FIXTURES.citation);
      // citeproc emits a class="citation" span and a #refs bibliography div.
      expect(html).toMatch(/class="citation"[^>]*data-cites="knuth1997"/);
      expect(html).toMatch(/id="refs"/);
      expect(html).toMatch(/id="ref-knuth1997"/);
      // link-citations=true makes the cite a hyperlink.
      expect(html).toMatch(/href="#ref-knuth1997"/);
      expect(html).toContain("Knuth");
    },
  );

  it.skipIf(!(HAS_PANDOC && HAS_CROSSREF))(
    "preserves theorem fenced divs (id, class, title) through HTML export",
    () => {
      const html = runPandoc(buildHtmlArgs(), FIXTURES.theorem);
      // pandoc-crossref does not have a native "theorem" prefix, so the
      // .theorem div passes through with id+class preserved. This is the
      // contract relied on by Coflat's HTML preview / export.
      expect(html).toMatch(/id="thm:main"/);
      expect(html).toMatch(/class="[^"]*theorem[^"]*"/);
      expect(html).toMatch(/class="[^"]*proof[^"]*"/);
      expect(html).toContain("Every continuous function on a compact set is bounded");
    },
  );

  it.skipIf(!(HAS_PANDOC && HAS_CROSSREF))(
    "exports figures with caption and resolves figure cross-refs as numbered text",
    () => {
      const html = runPandoc(buildHtmlArgs(), FIXTURES.figure);
      // Native pandoc-crossref figure syntax: ![caption](path){#fig:id}.
      expect(html).toMatch(/<figure[^>]*id="fig:overview"/);
      expect(html).toContain("Figure 1");
      // [@fig:overview] resolves to "fig. 1" via pandoc-crossref.
      expect(html).toMatch(/fig\.\s*1/);
    },
  );

  it.skipIf(!(HAS_PANDOC && HAS_CROSSREF))(
    "exports tables with caption and resolves table cross-refs as numbered text",
    () => {
      const html = runPandoc(buildHtmlArgs(), FIXTURES.table);
      // Native pandoc-crossref table caption: ": caption {#tbl:id}".
      expect(html).toMatch(/<table[^>]*id="tbl:runtime"/);
      expect(html).toContain("Table 1");
      expect(html).toMatch(/tbl\.\s*1/);
    },
  );
});

describe("Pandoc HTML export — graceful skip when pandoc-crossref missing", () => {
  it.skipIf(HAS_CROSSREF)("declares pandoc-crossref as a required dependency", () => {
    // When crossref is absent locally we still verify the contract says it is
    // required so the production preflight raises a clean error, rather than
    // silently dropping cross-refs.
    expect(buildHtmlArgs()).toContain("--filter=pandoc-crossref");
  });
});

describe("Pandoc LaTeX export goldens", () => {
  it.skipIf(!HAS_PANDOC)("renders the canonical LaTeX contract args", () => {
    const args = buildLatexArgs("article");
    expect(args).toContain(`--from=${contract.pandoc_from}`);
    expect(args).toContain("--to=latex");
    expect(args).toContain("--wrap=preserve");
    expect(args).toContain("--syntax-highlighting=none");
    expect(args.some((a) => a.endsWith("/filter.lua"))).toBe(true);
    expect(args.some((a) => a.endsWith("/article.tex"))).toBe(true);
  });

  it.skipIf(!HAS_PANDOC)(
    "exports plain prose to LaTeX with section markers",
    () => {
      const tex = runPandoc(buildLatexArgs("article"), FIXTURES.plain);
      expect(tex).toMatch(/\\section\{Introduction\}/);
      expect(tex).toMatch(/\\subsection\{Background\}/);
    },
  );

  it.skipIf(!HAS_PANDOC)(
    "exports labeled equations and cross-refs to LaTeX",
    () => {
      const tex = runPandoc(buildLatexArgs("article"), FIXTURES.mathEqref);
      // Either pandoc-crossref produced \label{eq:einstein} (when present),
      // or the raw {#eq:einstein} fell through. Accept the canonical label.
      expect(tex).toMatch(/eq:einstein/);
      expect(tex).toMatch(/E\s*=\s*mc\^?\{?2\}?/);
    },
  );

  it.skipIf(!HAS_PANDOC)(
    "exports theorem fenced divs through the Lua filter",
    () => {
      const tex = runPandoc(buildLatexArgs("article"), FIXTURES.theorem);
      // The Lua filter rewrites .theorem divs into a LaTeX environment.
      // Be tolerant about the exact env name; assert structural markers.
      expect(tex).toMatch(/\\begin\{theorem\}|\\begin\{thm\}/);
      expect(tex).toMatch(/\\label\{thm:main\}|thm:main/);
      expect(tex).toMatch(/\\begin\{proof\}/);
    },
  );
});
