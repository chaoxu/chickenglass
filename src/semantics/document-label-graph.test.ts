import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { frontmatterField } from "../state/frontmatter-state";
import {
  buildDocumentLabelGraph as buildPlainDocumentLabelGraph,
} from "../lib/markdown/label-graph";
import {
  prepareDocumentLabelRename as preparePlainDocumentLabelRename,
  resolveDocumentLabelBacklinks as resolvePlainDocumentLabelBacklinks,
} from "../lib/markdown/label-actions";
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
  type DocumentLabelGraph,
  validateDocumentLabelRename,
} from "./document-label-graph";
import { documentAnalysisField } from "../state/document-analysis";
import { resolveDocumentLabelBacklinks as resolveCmDocumentLabelBacklinks } from "./document-label-backlinks";
import { prepareDocumentLabelRename as prepareCmDocumentLabelRename } from "./document-label-rename";

function graphExtensions() {
  return [
    frontmatterField,
    markdown({ extensions: markdownExtensions }),
    documentAnalysisField,
    createPluginRegistryField(defaultPlugins),
    blockCounterField,
    editorBlockReferenceTargetInputsField,
    documentReferenceCatalogField,
    documentLabelGraphField,
  ];
}

function createGraphState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: graphExtensions(),
  });
}

function createGraphSelectionState(doc: string, anchor: number, head = anchor): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: graphExtensions(),
  });
}

function summarizeGraph(graph: DocumentLabelGraph) {
  return {
    definitions: graph.definitions.map((definition) => ({
      id: definition.id,
      kind: definition.kind,
      from: definition.from,
      to: definition.to,
      labelFrom: definition.labelFrom,
      labelTo: definition.labelTo,
    })),
    duplicateIds: [...graph.duplicatesById.keys()],
    references: graph.references.map((reference) => ({
      id: reference.id,
      from: reference.from,
      to: reference.to,
      labelFrom: reference.labelFrom,
      labelTo: reference.labelTo,
      locator: reference.locator,
    })),
  };
}

function summarizeBacklinks(lookup: ReturnType<typeof resolveCmDocumentLabelBacklinks>) {
  if (lookup.kind !== "ready") {
    return lookup;
  }
  return {
    kind: "ready",
    source: lookup.result.source,
    definition: {
      id: lookup.result.definition.id,
      kind: lookup.result.definition.kind,
      from: lookup.result.definition.from,
      to: lookup.result.definition.to,
    },
    backlinks: lookup.result.backlinks.map((backlink) => ({
      from: backlink.from,
      to: backlink.to,
      lineNumber: backlink.lineNumber,
      referenceText: backlink.referenceText,
      locator: backlink.locator,
    })),
  };
}

function normalizeChanges(changes: readonly unknown[]) {
  return changes.map((change) => {
    if (typeof change !== "object" || change === null) {
      throw new Error(`Expected object change, got ${String(change)}`);
    }
    const spec = change as { from?: unknown; to?: unknown; insert?: unknown };
    if (typeof spec.from !== "number" || spec.to !== undefined && typeof spec.to !== "number") {
      throw new Error(`Expected positional change, got ${JSON.stringify(change)}`);
    }
    return {
      from: spec.from,
      to: spec.to ?? spec.from,
      insert: String(spec.insert ?? ""),
    };
  });
}

function applyTextChanges(doc: string, changes: readonly unknown[]): string {
  return [...normalizeChanges(changes)]
    .sort((left, right) => right.from - left.from || right.to - left.to)
    .reduce(
      (current, change) =>
        `${current.slice(0, change.from)}${change.insert}${current.slice(change.to)}`,
      doc,
    );
}

describe("buildDocumentLabelGraph", () => {
  it("indexes local definitions and per-id backlink ranges while excluding citations", () => {
    const doc = [
      "# Intro {#sec:intro}",
      "",
      '::: {.theorem #thm:main title="Main Result"}',
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
      '::: {.theorem #dup title="Duplicate"}',
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
    expect(isValidDocumentLabelId("single-letter-cite-style/x")).toBe(true);
    expect(isValidDocumentLabelId("bad label")).toBe(false);
    expect(isValidDocumentLabelId("sec:trailing-")).toBe(false);
    expect(isValidDocumentLabelId("sec:trailing:")).toBe(false);

    expect(validateDocumentLabelRename(graph, "fresh-id")).toEqual({
      ok: true,
      id: "fresh-id",
    });
    expect(validateDocumentLabelRename(graph, "bad label")).toEqual({
      ok: false,
      id: "bad label",
      reason: "invalid-format",
    });
    expect(validateDocumentLabelRename(graph, "sec:trailing-")).toEqual({
      ok: false,
      id: "sec:trailing-",
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

describe("document label adapter parity", () => {
  it("keeps duplicate and backlink graph behavior identical across CM6 and plain text", () => {
    const doc = [
      "# Intro {#sec:intro}",
      "",
      '::: {.theorem #dup title="First"}',
      "Body.",
      ":::",
      "",
      '::: {.lemma #dup title="Second"}',
      "Body.",
      ":::",
      "",
      "$$",
      "x + y",
      "$$ {#eq:main}",
      "",
      "See [@dup] and @sec:intro and [@eq:main, p. 2] and [@missing] and [@karger2000].",
    ].join("\n");

    const cmGraph = buildDocumentLabelGraph(createGraphState(doc));
    const plainGraph = buildPlainDocumentLabelGraph(doc);

    expect(summarizeGraph(cmGraph)).toEqual(summarizeGraph(plainGraph));
    expect(summarizeGraph(cmGraph).references.map((reference) => reference.id)).toEqual([
      "dup",
      "sec:intro",
      "eq:main",
    ]);

    const referencePosition = doc.indexOf("@sec:intro") + 2;
    expect(summarizeBacklinks(
      resolveCmDocumentLabelBacklinks(createGraphSelectionState(doc, referencePosition)),
    )).toEqual(summarizeBacklinks(
      resolvePlainDocumentLabelBacklinks(doc, referencePosition),
    ));
  });

  it("keeps rename planning and validation identical across CM6 and plain text", () => {
    const doc = [
      "# Intro {#sec:intro}",
      "",
      "See @sec:intro and [@sec:intro, p. 2] and [@karger2000].",
    ].join("\n");
    const selection = doc.indexOf("@sec:intro") + 2;
    const cmState = createGraphSelectionState(doc, selection);
    const cmRename = prepareCmDocumentLabelRename(cmState, "sec:overview");
    const plainRename = preparePlainDocumentLabelRename(doc, selection, "sec:overview");

    expect(cmRename.kind).toBe("ready");
    expect(plainRename.kind).toBe("ready");
    if (cmRename.kind !== "ready" || plainRename.kind !== "ready") return;

    expect({
      currentId: cmRename.currentId,
      nextId: cmRename.nextId,
      referenceCount: cmRename.referenceCount,
      changes: normalizeChanges(cmRename.changes),
    }).toEqual({
      currentId: plainRename.currentId,
      nextId: plainRename.nextId,
      referenceCount: plainRename.referenceCount,
      changes: normalizeChanges(plainRename.changes),
    });
    expect(applyTextChanges(doc, cmRename.changes)).toBe(applyTextChanges(
      doc,
      plainRename.changes,
    ));

    const cmInvalid = prepareCmDocumentLabelRename(cmState, " sec:invalid");
    const plainInvalid = preparePlainDocumentLabelRename(doc, selection, " sec:invalid");
    expect(cmInvalid.kind).toBe("invalid");
    expect(plainInvalid.kind).toBe("invalid");
    if (cmInvalid.kind !== "invalid" || plainInvalid.kind !== "invalid") return;

    expect({
      id: cmInvalid.validation.id,
      reason: cmInvalid.validation.reason,
    }).toEqual({
      id: plainInvalid.validation.id,
      reason: plainInvalid.validation.reason,
    });
  });
});

describe("documentLabelGraphField", () => {
  it("rebuilds numbering from current editor state after edits", () => {
    const before = createGraphState([
      '::: {.theorem #thm:a title="First"}',
      "Body.",
      ":::",
    ].join("\n"));

    expect(before.field(documentLabelGraphField).uniqueDefinitionById.get("thm:a")?.displayLabel)
      .toBe("Theorem 1");

    const after = before.update({
      changes: {
        from: 0,
        insert: [
          '::: {.theorem #thm:b title="Second"}',
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
      '::: {.theorem #thm:main title="Main Result"}',
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
