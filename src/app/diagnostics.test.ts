import { describe, expect, it } from "vitest";
import type { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { fencedDiv } from "../parser/fenced-div";
import { footnoteExtension } from "../parser/footnote";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { frontmatterField } from "../state/frontmatter-state";
import { blockCounterField } from "../state/block-counter";
import { createPluginRegistryField } from "../state/plugin-registry";
import { documentSemanticsField } from "../state/document-analysis";
import { mathMacrosField } from "../state/math-macros";
import { bibDataEffect, bibDataField, type BibliographyStatus } from "../state/bib-data";
import { CslProcessor } from "../citations/csl-processor";
import { projectConfigStatusFacet } from "../project-config";
import type { BlockPlugin } from "../plugins/plugin-types";
import {
  CSL_FIXTURES,
  applyStateEffects,
  createEditorState,
  makeBibStore,
  makeBlockPlugin,
} from "../test-utils";
import { extractDiagnostics } from "./diagnostics";

const testPlugins: readonly BlockPlugin[] = [
  makeBlockPlugin({ name: "theorem", counter: "theorem", title: "Theorem" }),
  makeBlockPlugin({ name: "lemma", counter: "theorem", title: "Lemma" }),
  makeBlockPlugin({ name: "definition", title: "Definition" }),
];

function createState(doc: string): EditorState {
  return createEditorState(doc, {
    extensions: [
      markdown({
        extensions: [fencedDiv, mathExtension, equationLabelExtension, footnoteExtension],
      }),
      frontmatterField,
      documentSemanticsField,
      mathMacrosField,
      createPluginRegistryField(testPlugins),
      blockCounterField,
      bibDataField,
    ],
  });
}

function withBibliography(state: EditorState): EditorState {
  return applyStateEffects(state, bibDataEffect.of({
    store: makeBibStore([CSL_FIXTURES.karger]),
    cslProcessor: new CslProcessor([CSL_FIXTURES.karger]),
    status: { state: "ok", bibPath: "refs.bib" },
  }));
}

function withBibliographyStatus(
  state: EditorState,
  status: BibliographyStatus,
): EditorState {
  return applyStateEffects(state, bibDataEffect.of({
    store: new Map(),
    cslProcessor: CslProcessor.empty(),
    status,
  }));
}

describe("extractDiagnostics", () => {
  it("warns on unresolved references without flagging known citations", () => {
    const state = withBibliography(createState(
      "See [@thm:missing] and [@karger2000].",
    ));

    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "warning",
        source: "reference",
        code: "reference.unresolved",
        message: "Unresolved reference \"@thm:missing\"",
      }),
    ]);
  });

  it("reports invalid inline math", () => {
    const state = createState("Text $\\oops{x}$ more.");

    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "error",
        source: "math",
        code: "math.render",
        message: expect.stringContaining("Invalid math:"),
        from: "Text $".length,
        to: "Text $\\oops{x}".length,
      }),
    ]);
  });

  it("filters unsafe bare macro keys before validating math", () => {
    const state = createState([
      "---",
      "math:",
      '  R: "\\\\mathbb{R}"',
      "---",
      "",
      "Text $\\R$ more.",
    ].join("\n"));

    expect(extractDiagnostics(state).map((diagnostic) => diagnostic.message)).not.toContain(
      "Maximum call stack size exceeded",
    );
  });

  it("warns when a footnote reference has no definition", () => {
    const state = createState("Text[^missing].");

    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "warning",
        source: "footnote",
        code: "footnote.missing-definition",
        message: 'Missing footnote definition "[^missing]"',
      }),
    ]);
  });

  it("warns when a footnote definition is never referenced", () => {
    const state = createState("[^orphan]: orphan body");

    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "warning",
        source: "footnote",
        code: "footnote.orphan-definition",
        message: 'Footnote definition "[^orphan]" is never referenced',
      }),
    ]);
  });

  it("reports cross-namespace local target collisions", () => {
    const state = createState([
      "# Intro {#dup}",
      "",
      "::: {.theorem #dup}",
      "Statement.",
      ":::",
    ].join("\n"));

    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "error",
        message: "Duplicate local target ID \"dup\"",
      }),
    ]);
  });

  it("reports duplicate heading IDs from the shared reference conflict model", () => {
    const state = createState([
      "# First {#dup}",
      "",
      "# Second {#dup}",
    ].join("\n"));

    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "error",
        message: "Duplicate heading ID \"dup\"",
      }),
    ]);
  });

  it("reports duplicate equation labels from the shared reference conflict model", () => {
    const state = createState([
      "$$ x $$ {#eq:dup}",
      "",
      "$$ y $$ {#eq:dup}",
    ].join("\n"));

    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "error",
        message: "Duplicate equation label \"eq:dup\"",
      }),
    ]);
  });

  it("reports local targets that collide with bibliography keys", () => {
    const state = withBibliography(createState([
      "# Local Karger {#karger2000}",
      "",
      "See [@karger2000].",
    ].join("\n")));

    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "warning",
        source: "reference",
        code: "reference.citation-local-collision",
        message: "Local target ID \"karger2000\" shadows a bibliography entry",
      }),
    ]);
  });

  it("does not also warn unresolved when a reference points at duplicate local targets", () => {
    const state = createState([
      "# First {#dup}",
      "",
      "# Second {#dup}",
      "",
      "See [@dup].",
    ].join("\n"));

    expect(extractDiagnostics(state).map((diagnostic) => diagnostic.message)).toEqual([
      "Duplicate heading ID \"dup\"",
    ]);
  });

  it("reports malformed frontmatter as a configuration diagnostic", () => {
    const state = createState([
      "---",
      "bibliography: [",
      "---",
      "See [@smith2020].",
    ].join("\n"));

    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "error",
        source: "frontmatter",
        code: "frontmatter.parse",
      }),
      expect.objectContaining({
        severity: "warning",
        source: "reference",
        code: "reference.unresolved",
      }),
    ]);
  });

  it("reports project-config parse failures from state", () => {
    const state = createEditorState("Body", {
      extensions: [
        markdown({
          extensions: [fencedDiv, mathExtension, equationLabelExtension],
        }),
        projectConfigStatusFacet.of({
          state: "error",
          path: "coflat.yaml",
          kind: "parse",
          message: "bad yaml",
        }),
        frontmatterField,
        documentSemanticsField,
        createPluginRegistryField(testPlugins),
        blockCounterField,
        bibDataField,
      ],
    });

    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "error",
        source: "project-config",
        code: "project-config.parse",
        message: "Project config parse failed: bad yaml",
      }),
    ]);
  });

  it("reports bibliography load failures without treating citations as unresolved", () => {
    const state = withBibliographyStatus(
      createState("See [@smith2020] and [@thm:missing]."),
      {
        state: "error",
        kind: "read-bib",
        bibPath: "refs.bib",
        message: "missing",
      },
    );

    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "error",
        source: "bibliography",
        code: "bibliography.read",
      }),
      expect.objectContaining({
        severity: "warning",
        source: "reference",
        code: "reference.unresolved",
        message: "Unresolved reference \"@thm:missing\"",
      }),
    ]);
    expect(extractDiagnostics(state).map((diagnostic) => diagnostic.message)).not.toContain(
      "Unresolved reference \"@smith2020\"",
    );
  });

  it("reports CSL style failures as bibliography warnings", () => {
    const state = withBibliographyStatus(
      createState("See [@smith2020]."),
      {
        state: "warning",
        kind: "style-csl",
        bibPath: "refs.bib",
        cslPath: "bad.csl",
        message: "invalid style",
      },
    );

    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "warning",
        source: "bibliography",
        code: "bibliography.style",
        message: "CSL style parse failed: invalid style",
      }),
      expect.objectContaining({
        severity: "warning",
        source: "reference",
        code: "reference.unresolved",
      }),
    ]);
  });

  it("warns when a fenced-div opener has a second attribute block appended", () => {
    const state = createState([
      "::: {.theorem} {#thm:squares title=\"Sum of squares\"}",
      "Body.",
      ":::",
    ].join("\n"));

    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "warning",
        source: "fenced-div",
        code: "fenced-div.opener-trailing",
      }),
    ]);
  });

  it("does not warn on a canonical single-block fenced-div opener", () => {
    const state = createState([
      "::: {.theorem #thm:squares title=\"Sum of squares\"}",
      "Body.",
      ":::",
    ].join("\n"));

    expect(extractDiagnostics(state)).toEqual([]);
  });

  it("warns on HTML comments", () => {
    const state = createState("Hello <!-- TODO --> world.");
    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "warning",
        source: "format",
        code: "format.html-comment",
      }),
    ]);
  });

  it("warns on raw inline HTML tags", () => {
    const state = createState("Click <a href=\"x\">here</a>.");
    const diagnostics = extractDiagnostics(state);
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          source: "format",
          code: "format.html-tag",
        }),
      ]),
    );
  });

  it("warns on reference-style link definitions", () => {
    const state = createState([
      "See [the spec][spec].",
      "",
      "[spec]: https://example.com/spec",
    ].join("\n"));
    const diagnostics = extractDiagnostics(state);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          source: "format",
          code: "format.reference-link-definition",
        }),
      ]),
    );
  });

  it("warns on bare URL autolinks", () => {
    const state = createState("Visit <https://example.com>.");
    expect(extractDiagnostics(state)).toEqual([
      expect.objectContaining({
        severity: "warning",
        source: "format",
        code: "format.bare-url-autolink",
      }),
    ]);
  });

  it("does not warn on inline links with URLs", () => {
    const state = createState("Visit [the site](https://example.com) today.");
    expect(extractDiagnostics(state)).toEqual([]);
  });

  it("does not warn on URLs inside fenced code blocks", () => {
    const state = createState([
      "```",
      "Visit https://example.com or <!-- comment -->",
      "```",
    ].join("\n"));
    expect(extractDiagnostics(state)).toEqual([]);
  });

  it("does not warn on a clean canonical document", () => {
    const state = createState([
      "# Title",
      "",
      "Plain prose with [an inline link](https://example.com) and $math$.",
      "",
      "::: {.theorem #thm:x}",
      "Body.",
      ":::",
    ].join("\n"));
    expect(extractDiagnostics(state)).toEqual([]);
  });
});
