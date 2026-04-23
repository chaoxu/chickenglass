import { describe, expect, it } from "vitest";
import type { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { frontmatterField } from "../../editor/frontmatter-state";
import { equationLabelExtension } from "../../parser/equation-label";
import { fencedDiv } from "../../parser/fenced-div";
import { mathExtension } from "../../parser/math-backslash";
import { documentSemanticsField } from "../../state/document-analysis";
import { blockCounterField } from "../../state/block-counter";
import { createPluginRegistryField } from "../../state/plugin-registry";
import { bibDataEffect, bibDataField } from "../../state/bib-data";
import {
  CSL_FIXTURES,
  applyStateEffects,
  createEditorState,
  makeBibStore,
  makeBlockPlugin,
} from "../../test-utils";
import { CslProcessor } from "../../citations/csl-processor";
import type { BlockPlugin } from "../../plugins/plugin-types";
import { extractHeadings } from "../heading-ancestry";
import {
  createDiagnosticsSidebarChangeChecker,
  createHeadingSidebarMetadata,
  sameHeadingSidebarMetadata,
} from "./editor-pane-sidebar-tracking";

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
  }));
}

describe("editor pane sidebar tracking", () => {
  it("treats headings with the same visible metadata as unchanged", () => {
    const before = createState([
      "# Intro",
      "",
      "Text.",
      "",
      "## Next",
    ].join("\n"));
    const after = createState([
      "Preamble.",
      "",
      "# Intro",
      "",
      "Text.",
      "",
      "## Next",
    ].join("\n"));

    expect(sameHeadingSidebarMetadata(
      createHeadingSidebarMetadata(extractHeadings(before)),
      createHeadingSidebarMetadata(extractHeadings(after)),
    )).toBe(true);
  });

  it("ignores diagnostics-only position remaps", () => {
    const diagnosticsChanged = createDiagnosticsSidebarChangeChecker();
    const before = createState([
      "# Intro {#sec:intro}",
      "",
      "See [@thm:main] and [@eq:one].",
      "",
      "::: {.theorem #thm:main}",
      "Statement.",
      ":::",
      "",
      "$$ x $$ {#eq:one}",
    ].join("\n"));
    const after = createState([
      "Preamble.",
      "",
      "# Intro {#sec:intro}",
      "",
      "See [@thm:main] and [@eq:one].",
      "",
      "::: {.theorem #thm:main}",
      "Statement.",
      ":::",
      "",
      "$$ x $$ {#eq:one}",
    ].join("\n"));

    expect(diagnosticsChanged(before, after)).toBe(false);
  });

  it("detects heading target id changes for diagnostics", () => {
    const diagnosticsChanged = createDiagnosticsSidebarChangeChecker();
    const before = createState("# Intro {#sec:intro}\n");
    const after = createState("# Intro {#sec:overview}\n");

    expect(diagnosticsChanged(before, after)).toBe(true);
  });

  it("detects unresolved reference id changes for diagnostics", () => {
    const diagnosticsChanged = createDiagnosticsSidebarChangeChecker();
    const before = createState("See [@thm:missing].\n");
    const after = createState("See [@thm:other].\n");

    expect(diagnosticsChanged(before, after)).toBe(true);
  });

  it("detects bibliography id-set changes for diagnostics", () => {
    const diagnosticsChanged = createDiagnosticsSidebarChangeChecker();
    const before = createState("See [@karger2000].\n");
    const after = withBibliography(before);

    expect(diagnosticsChanged(before, after)).toBe(true);
  });
});
