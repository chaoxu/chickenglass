import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { frontmatterField } from "../editor/frontmatter-state";
import { markdownExtensions } from "../parser";
import {
  defaultPlugins,
} from "../plugins";
import { blockCounterField } from "../state/block-counter";
import { documentLabelGraphField } from "../state/document-label-graph";
import { createPluginRegistryField } from "../state/plugin-registry";
import {
  documentReferenceCatalogField,
  editorBlockReferenceTargetInputsField,
} from "./editor-reference-catalog";
import {
  buildDocumentLabelGraph,
  findDocumentLabelBacklinks,
  getDocumentLabelDefinition,
  getDocumentLabelDefinitions,
  isValidDocumentLabelId,
  validateDocumentLabelRename,
} from "./document-label-graph";
import { documentAnalysisField } from "../state/document-analysis";

function createGraphState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      frontmatterField,
      markdown({ extensions: markdownExtensions }),
      documentAnalysisField,
      createPluginRegistryField(defaultPlugins),
      blockCounterField,
      editorBlockReferenceTargetInputsField,
      documentReferenceCatalogField,
      documentLabelGraphField,
    ],
  });
}

describe("buildDocumentLabelGraph", () => {
  it("indexes local definitions and per-id backlink ranges while excluding citations", () => {
    const doc = [
      "# Intro {#sec:intro}",
      "",
      "::: {.theorem #thm:main} Main Result",
      "Body.",
      ":::",
      "",
      "$$",
      "x + y",
      "$$ {#eq:main}",
      "",
      "See [@thm:main, p. 2; @eq:main] and @sec:intro and [@karger2000].",
    ].join("\n");

    const state = createGraphState(doc);
    const graph = buildDocumentLabelGraph(state);

    expect(graph.definitions.map((definition) => definition.id)).toEqual([
      "sec:intro",
      "thm:main",
      "eq:main",
    ]);

    expect(getDocumentLabelDefinition(graph, "sec:intro")).toMatchObject({
      kind: "heading",
      displayLabel: "Section 1",
      title: "Intro",
      tokenFrom: doc.indexOf("#sec:intro"),
      labelFrom: doc.indexOf("#sec:intro") + 1,
    });
    expect(getDocumentLabelDefinition(graph, "thm:main")).toMatchObject({
      kind: "block",
      blockType: "theorem",
      displayLabel: "Theorem 1",
      title: "Main Result",
      tokenFrom: doc.indexOf("#thm:main"),
      labelFrom: doc.indexOf("#thm:main") + 1,
    });
    expect(getDocumentLabelDefinition(graph, "eq:main")).toMatchObject({
      kind: "equation",
      displayLabel: "Eq. (1)",
      text: "x + y",
      tokenFrom: doc.indexOf("{#eq:main}"),
      labelFrom: doc.indexOf("{#eq:main}") + 2,
    });

    expect(graph.references.map((reference) => reference.id)).toEqual([
      "thm:main",
      "eq:main",
      "sec:intro",
    ]);
    expect(findDocumentLabelBacklinks(graph, "karger2000")).toEqual([]);

    const clusterFrom = doc.indexOf("[@thm:main, p. 2; @eq:main]");
    const clusterTo = clusterFrom + "[@thm:main, p. 2; @eq:main]".length;
    const theoremBacklink = findDocumentLabelBacklinks(graph, "thm:main")[0];
    expect(theoremBacklink).toEqual({
      id: "thm:main",
      from: doc.indexOf("@thm:main"),
      to: doc.indexOf("@thm:main") + "@thm:main".length,
      labelFrom: doc.indexOf("@thm:main") + 1,
      labelTo: doc.indexOf("@thm:main") + "@thm:main".length,
      clusterFrom,
      clusterTo,
      clusterIndex: 0,
      bracketed: true,
      locator: "p. 2",
    });

    const equationBacklink = findDocumentLabelBacklinks(graph, "eq:main")[0];
    expect(equationBacklink).toEqual({
      id: "eq:main",
      from: doc.indexOf("@eq:main"),
      to: doc.indexOf("@eq:main") + "@eq:main".length,
      labelFrom: doc.indexOf("@eq:main") + 1,
      labelTo: doc.indexOf("@eq:main") + "@eq:main".length,
      clusterFrom,
      clusterTo,
      clusterIndex: 1,
      bracketed: true,
      locator: undefined,
    });
  });

  it("tracks duplicates and rename validation without treating unresolved refs as local", () => {
    const doc = [
      "# Intro {#dup}",
      "",
      "::: {.theorem #dup} Duplicate",
      "Body.",
      ":::",
      "",
      "See [@dup] and [@missing].",
    ].join("\n");

    const graph = createGraphState(doc).field(documentLabelGraphField);

    expect(getDocumentLabelDefinition(graph, "dup")).toBeUndefined();
    expect(getDocumentLabelDefinitions(graph, "dup")).toHaveLength(2);
    expect(graph.duplicatesById.get("dup")).toHaveLength(2);
    expect(graph.references.map((reference) => reference.id)).toEqual(["dup"]);

    expect(isValidDocumentLabelId("sec:intro")).toBe(true);
    expect(isValidDocumentLabelId("bad label")).toBe(false);

    expect(validateDocumentLabelRename(graph, "fresh-id")).toEqual({
      ok: true,
      id: "fresh-id",
    });
    expect(validateDocumentLabelRename(graph, "bad label")).toEqual({
      ok: false,
      id: "bad label",
      reason: "invalid-format",
    });
    expect(validateDocumentLabelRename(graph, "dup", { currentId: "dup" })).toEqual({
      ok: true,
      id: "dup",
    });
    expect(validateDocumentLabelRename(graph, "dup")).toMatchObject({
      ok: false,
      id: "dup",
      reason: "collision",
    });
  });
});

describe("documentLabelGraphField", () => {
  it("rebuilds numbering from current editor state after edits", () => {
    const before = createGraphState([
      "::: {.theorem #thm:a} First",
      "Body.",
      ":::",
    ].join("\n"));

    expect(before.field(documentLabelGraphField).uniqueDefinitionById.get("thm:a")?.displayLabel)
      .toBe("Theorem 1");

    const after = before.update({
      changes: {
        from: 0,
        insert: [
          "::: {.theorem #thm:b} Second",
          "Body.",
          ":::",
          "",
        ].join("\n"),
      },
    }).state;
    const graph = after.field(documentLabelGraphField);

    expect(graph.uniqueDefinitionById.get("thm:b")?.displayLabel).toBe("Theorem 1");
    expect(graph.uniqueDefinitionById.get("thm:a")?.displayLabel).toBe("Theorem 2");
  });

  it("maps definition and backlink positions across unrelated prose edits", () => {
    const before = createGraphState([
      "# Intro {#sec:intro}",
      "",
      "Lead paragraph.",
      "",
      "::: {.theorem #thm:main} Main Result",
      "Body.",
      ":::",
      "",
      "See [@thm:main] and @sec:intro.",
    ].join("\n"));
    const graphBefore = before.field(documentLabelGraphField);
    const headingBefore = graphBefore.uniqueDefinitionById.get("sec:intro");
    const theoremBefore = graphBefore.uniqueDefinitionById.get("thm:main");
    const theoremBacklinkBefore = findDocumentLabelBacklinks(graphBefore, "thm:main")[0];
    const headingBacklinkBefore = findDocumentLabelBacklinks(graphBefore, "sec:intro")[0];

    const insert = " Updated";
    const after = before.update({
      changes: {
        from: "# Intro".length,
        insert,
      },
    }).state;
    const graphAfter = after.field(documentLabelGraphField);
    const headingAfter = graphAfter.uniqueDefinitionById.get("sec:intro");
    const theoremAfter = graphAfter.uniqueDefinitionById.get("thm:main");
    const theoremBacklinkAfter = findDocumentLabelBacklinks(graphAfter, "thm:main")[0];
    const headingBacklinkAfter = findDocumentLabelBacklinks(graphAfter, "sec:intro")[0];

    expect(headingBefore).toBeDefined();
    expect(theoremBefore).toBeDefined();
    expect(theoremBacklinkBefore).toBeDefined();
    expect(headingBacklinkBefore).toBeDefined();
    expect(headingAfter?.labelFrom).toBe((headingBefore?.labelFrom ?? 0) + insert.length);
    expect(theoremAfter?.from).toBe((theoremBefore?.from ?? 0) + insert.length);
    expect(theoremBacklinkAfter?.from).toBe((theoremBacklinkBefore?.from ?? 0) + insert.length);
    expect(headingBacklinkAfter?.from).toBe((headingBacklinkBefore?.from ?? 0) + insert.length);
  });
});
