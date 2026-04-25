import { describe, expect, it } from "vitest";
import type { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { fencedDiv } from "../parser/fenced-div";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { frontmatterField } from "../editor/frontmatter-state";
import { blockCounterField } from "../state/block-counter";
import { createPluginRegistryField } from "../state/plugin-registry";
import { documentSemanticsField } from "../state/document-analysis";
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
        extensions: [fencedDiv, mathExtension, equationLabelExtension],
      }),
      frontmatterField,
      documentSemanticsField,
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
});
