import { Compartment, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  createRegistryState,
  createPluginRegistryField,
  pluginRegistryField,
  registerPlugins,
  unregisterPlugin,
  type PluginRegistryState,
} from "./plugin-registry";
import {
  computeBlockNumbers,
  emptyCounterState,
} from "./block-counter";
import { markdown } from "@codemirror/lang-markdown";
import { fencedDiv } from "../parser/fenced-div";
import { frontmatterField } from "../editor/frontmatter-state";
import {
  documentSemanticsField,
  getDocumentAnalysisSliceRevision,
} from "../semantics/codemirror-source";
import { blockCounterField } from "../state/block-counter";
import { createEditorState, makeBlockPlugin } from "../test-utils";

/** Create an EditorState with the fenced div parser and a given document. */
function createState(doc: string) {
  return createEditorState(doc, {
    extensions: [
      markdown({ extensions: [fencedDiv] }),
      documentSemanticsField,
    ],
  });
}

/** Create a registry with common test plugins. */
function testRegistry(): PluginRegistryState {
  return registerPlugins(createRegistryState(), [
    makeBlockPlugin({ name: "theorem", counter: "theorem" }),
    makeBlockPlugin({ name: "lemma", counter: "theorem" }),
    makeBlockPlugin({ name: "definition" }),
    makeBlockPlugin({ name: "proof", numbered: false }),
  ]);
}

describe("emptyCounterState", () => {
  it("creates an empty state", () => {
    const state = emptyCounterState();
    expect(state.blocks).toHaveLength(0);
    expect(state.byId.size).toBe(0);
    expect(state.byPosition.size).toBe(0);
  });
});

describe("computeBlockNumbers", () => {
  it("assigns sequential numbers to blocks of the same type", () => {
    const doc = [
      "::: {.theorem}",
      "First theorem.",
      ":::",
      "",
      "::: {.theorem}",
      "Second theorem.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = testRegistry();
    const result = computeBlockNumbers(state, registry);

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].number).toBe(1);
    expect(result.blocks[0].type).toBe("theorem");
    expect(result.blocks[1].number).toBe(2);
    expect(result.blocks[1].type).toBe("theorem");
  });

  it("shares counter between theorem and lemma", () => {
    const doc = [
      "::: {.theorem}",
      "A theorem.",
      ":::",
      "",
      "::: {.lemma}",
      "A lemma.",
      ":::",
      "",
      "::: {.theorem}",
      "Another theorem.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = testRegistry();
    const result = computeBlockNumbers(state, registry);

    expect(result.blocks).toHaveLength(3);
    expect(result.blocks[0].type).toBe("theorem");
    expect(result.blocks[0].number).toBe(1);
    expect(result.blocks[1].type).toBe("lemma");
    expect(result.blocks[1].number).toBe(2);
    expect(result.blocks[2].type).toBe("theorem");
    expect(result.blocks[2].number).toBe(3);
  });

  it("uses separate counters for different groups", () => {
    const doc = [
      "::: {.theorem}",
      "A theorem.",
      ":::",
      "",
      "::: {.definition}",
      "A definition.",
      ":::",
      "",
      "::: {.theorem}",
      "Another theorem.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = testRegistry();
    const result = computeBlockNumbers(state, registry);

    expect(result.blocks).toHaveLength(3);
    expect(result.blocks[0].type).toBe("theorem");
    expect(result.blocks[0].number).toBe(1);
    expect(result.blocks[1].type).toBe("definition");
    expect(result.blocks[1].number).toBe(1);
    expect(result.blocks[2].type).toBe("theorem");
    expect(result.blocks[2].number).toBe(2);
  });

  it("skips unnumbered blocks", () => {
    const doc = [
      "::: {.theorem}",
      "A theorem.",
      ":::",
      "",
      "::: {.proof}",
      "A proof.",
      ":::",
      "",
      "::: {.theorem}",
      "Another theorem.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = testRegistry();
    const result = computeBlockNumbers(state, registry);

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].type).toBe("theorem");
    expect(result.blocks[0].number).toBe(1);
    expect(result.blocks[1].type).toBe("theorem");
    expect(result.blocks[1].number).toBe(2);
  });

  it("indexes blocks by id", () => {
    const doc = [
      "::: {.theorem #thm-main}",
      "Main theorem.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = testRegistry();
    const result = computeBlockNumbers(state, registry);

    expect(result.blocks).toHaveLength(1);
    expect(result.byId.get("thm-main")).toBeDefined();
    expect(result.byId.get("thm-main")?.number).toBe(1);
    expect(result.byId.get("thm-main")?.type).toBe("theorem");
  });

  it("indexes blocks by position", () => {
    const doc = [
      "::: {.theorem}",
      "A theorem.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = testRegistry();
    const result = computeBlockNumbers(state, registry);

    expect(result.blocks).toHaveLength(1);
    const entry = result.byPosition.get(result.blocks[0].from);
    expect(entry).toBeDefined();
    expect(entry?.number).toBe(1);
  });

  it("numbers unregistered div classes via fallback", () => {
    const doc = [
      "::: {.unknown-type}",
      "Not a registered plugin.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = testRegistry();
    const result = computeBlockNumbers(state, registry);

    // Fallback creates a numbered plugin on-the-fly
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("unknown-type");
    expect(result.blocks[0].number).toBe(1);
  });

  it("handles empty document", () => {
    const state = createState("");
    const registry = testRegistry();
    const result = computeBlockNumbers(state, registry);

    expect(result.blocks).toHaveLength(0);
  });

  it("handles document with no fenced divs", () => {
    const doc = "# Hello\n\nSome paragraph text.\n";
    const state = createState(doc);
    const registry = testRegistry();
    const result = computeBlockNumbers(state, registry);

    expect(result.blocks).toHaveLength(0);
  });

  it("numbers correctly after reordering (recompute)", () => {
    // Simulates what happens when blocks are reordered:
    // compute on the new document gives fresh sequential numbers.
    const doc1 = [
      "::: {.theorem #thm-a}",
      "Theorem A.",
      ":::",
      "",
      "::: {.theorem #thm-b}",
      "Theorem B.",
      ":::",
    ].join("\n");

    const doc2 = [
      "::: {.theorem #thm-b}",
      "Theorem B.",
      ":::",
      "",
      "::: {.theorem #thm-a}",
      "Theorem A.",
      ":::",
    ].join("\n");

    const state1 = createState(doc1);
    const state2 = createState(doc2);
    const registry = testRegistry();

    const result1 = computeBlockNumbers(state1, registry);
    const result2 = computeBlockNumbers(state2, registry);

    expect(result1.byId.get("thm-a")?.number).toBe(1);
    expect(result1.byId.get("thm-b")?.number).toBe(2);
    expect(result2.byId.get("thm-b")?.number).toBe(1);
    expect(result2.byId.get("thm-a")?.number).toBe(2);
  });

  it("uses plugin name as counter group when counter is undefined", () => {
    const registry = registerPlugins(createRegistryState(), [
      makeBlockPlugin({ name: "theorem" }), // no explicit counter
      makeBlockPlugin({ name: "lemma" }),    // no explicit counter
    ]);

    const doc = [
      "::: {.theorem}",
      "T1.",
      ":::",
      "",
      "::: {.lemma}",
      "L1.",
      ":::",
      "",
      "::: {.theorem}",
      "T2.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const result = computeBlockNumbers(state, registry);

    // Each type has its own counter since no shared group
    expect(result.blocks[0].number).toBe(1); // theorem 1
    expect(result.blocks[1].number).toBe(1); // lemma 1
    expect(result.blocks[2].number).toBe(2); // theorem 2
  });

  it("shares one counter across all types with global numbering", () => {
    const doc = [
      "::: {.theorem}",
      "A theorem.",
      ":::",
      "",
      "::: {.definition}",
      "A definition.",
      ":::",
      "",
      "::: {.theorem}",
      "Another theorem.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = testRegistry();
    const result = computeBlockNumbers(state, registry, "global");

    expect(result.blocks).toHaveLength(3);
    expect(result.blocks[0].type).toBe("theorem");
    expect(result.blocks[0].number).toBe(1);
    expect(result.blocks[1].type).toBe("definition");
    expect(result.blocks[1].number).toBe(2);
    expect(result.blocks[2].type).toBe("theorem");
    expect(result.blocks[2].number).toBe(3);
  });

  it("still skips unnumbered blocks with global numbering", () => {
    const doc = [
      "::: {.theorem}",
      "A theorem.",
      ":::",
      "",
      "::: {.proof}",
      "A proof.",
      ":::",
      "",
      "::: {.definition}",
      "A definition.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = testRegistry();
    const result = computeBlockNumbers(state, registry, "global");

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].type).toBe("theorem");
    expect(result.blocks[0].number).toBe(1);
    expect(result.blocks[1].type).toBe("definition");
    expect(result.blocks[1].number).toBe(2);
  });

  it("defaults to grouped numbering when scheme is undefined", () => {
    const doc = [
      "::: {.theorem}",
      "A theorem.",
      ":::",
      "",
      "::: {.definition}",
      "A definition.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = testRegistry();
    const result = computeBlockNumbers(state, registry);

    // Default (no scheme) = grouped: separate counters
    expect(result.blocks[0].number).toBe(1); // theorem 1
    expect(result.blocks[1].number).toBe(1); // definition 1
  });

  it("grouped numbering preserves existing counter group behavior", () => {
    const doc = [
      "::: {.theorem}",
      "T1.",
      ":::",
      "",
      "::: {.lemma}",
      "L1.",
      ":::",
      "",
      "::: {.definition}",
      "D1.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = testRegistry();
    const result = computeBlockNumbers(state, registry, "grouped");

    // theorem and lemma share "theorem" counter, definition is separate
    expect(result.blocks[0].number).toBe(1); // theorem 1
    expect(result.blocks[1].number).toBe(2); // lemma 2 (shared with theorem)
    expect(result.blocks[2].number).toBe(1); // definition 1
  });

  it("fallback divs each get their own counter group", () => {
    const doc = [
      "::: {.observation}",
      "First observation.",
      ":::",
      "",
      "::: {.conjecture2}",
      "A custom conjecture.",
      ":::",
      "",
      "::: {.observation}",
      "Second observation.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = testRegistry();
    const result = computeBlockNumbers(state, registry);

    expect(result.blocks).toHaveLength(3);
    expect(result.blocks[0].type).toBe("observation");
    expect(result.blocks[0].number).toBe(1);
    expect(result.blocks[1].type).toBe("conjecture2");
    expect(result.blocks[1].number).toBe(1); // different counter group
    expect(result.blocks[2].type).toBe("observation");
    expect(result.blocks[2].number).toBe(2);
  });

  it("skips disabled blocks (blocks: false) — no numbering, no fallback (issue #356)", () => {
    // Regression: when blocks: { theorem: false } is set, theorem blocks must be
    // invisible to the counter system (getPluginOrFallback returns undefined).
    // Previously they still got numbered via the fallback path because
    // unregisterPlugin only removed from plugins map while getPluginOrFallback
    // still returned a fallback for any unregistered name.
    const doc = [
      "::: {.theorem}",
      "A theorem.",
      ":::",
      "",
      "::: {.definition}",
      "A definition.",
      ":::",
      "",
      "::: {.theorem}",
      "Another theorem.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    // Start with definition registered, theorem explicitly disabled
    const base = registerPlugins(createRegistryState(), [
      makeBlockPlugin({ name: "definition" }),
    ]);
    const disabledRegistry = unregisterPlugin(base, "theorem");

    const result = computeBlockNumbers(state, disabledRegistry);

    // Only definition is counted; theorem blocks are invisible
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("definition");
    expect(result.blocks[0].number).toBe(1);
  });

  it("fallback divs mix with registered divs correctly", () => {
    const doc = [
      "::: {.theorem}",
      "A theorem.",
      ":::",
      "",
      "::: {.observation}",
      "An observation (unregistered).",
      ":::",
      "",
      "::: {.theorem}",
      "Another theorem.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = testRegistry();
    const result = computeBlockNumbers(state, registry);

    expect(result.blocks).toHaveLength(3);
    expect(result.blocks[0].type).toBe("theorem");
    expect(result.blocks[0].number).toBe(1);
    expect(result.blocks[1].type).toBe("observation");
    expect(result.blocks[1].number).toBe(1); // own counter
    expect(result.blocks[2].type).toBe("theorem");
    expect(result.blocks[2].number).toBe(2); // theorem counter not affected
  });

  it("global numbering assigns sequential numbers across all types", () => {
    const doc = [
      "::: {.theorem}",
      "T1.",
      ":::",
      "",
      "::: {.lemma}",
      "L1.",
      ":::",
      "",
      "::: {.definition}",
      "D1.",
      ":::",
      "",
      "::: {.theorem}",
      "T2.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = testRegistry();
    const result = computeBlockNumbers(state, registry, "global");

    expect(result.blocks).toHaveLength(4);
    expect(result.blocks[0].number).toBe(1); // Theorem 1
    expect(result.blocks[1].number).toBe(2); // Lemma 2
    expect(result.blocks[2].number).toBe(3); // Definition 3
    expect(result.blocks[3].number).toBe(4); // Theorem 4
  });
});

describe("blockCounterField", () => {
  it("does not recompute when unrelated semantic slices change", () => {
    const doc = [
      "# One",
      "",
      "::: {.theorem}",
      "Statement.",
      ":::",
    ].join("\n");
    const state = EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: [fencedDiv] }),
        frontmatterField,
        documentSemanticsField,
        createPluginRegistryField([makeBlockPlugin({ name: "theorem" })]),
        blockCounterField,
      ],
    });
    const counter1 = state.field(blockCounterField);
    const semantics1 = state.field(documentSemanticsField);

    const headingStart = doc.indexOf("One");
    const tr = state.update({
      changes: { from: headingStart, to: headingStart + 3, insert: "Two" },
    });
    const counter2 = tr.state.field(blockCounterField);
    const semantics2 = tr.state.field(documentSemanticsField);

    expect(semantics2).not.toBe(semantics1);
    expect(getDocumentAnalysisSliceRevision(semantics2, "fencedDivs")).toBe(
      getDocumentAnalysisSliceRevision(semantics1, "fencedDivs"),
    );
    expect(counter2).toBe(counter1);
  });

  it("recomputes when the plugin registry changes without fenced-div churn", () => {
    const doc = [
      "::: {.theorem}",
      "Statement.",
      ":::",
    ].join("\n");
    const builtinCompartment = new Compartment();
    const state = EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: [fencedDiv] }),
        frontmatterField,
        documentSemanticsField,
        builtinCompartment.of(
          createPluginRegistryField([makeBlockPlugin({ name: "theorem" })]),
        ),
        blockCounterField,
      ],
    });
    const counter1 = state.field(blockCounterField);
    const semantics1 = state.field(documentSemanticsField);
    const registry1 = state.field(pluginRegistryField);

    const tr = state.update({
      effects: builtinCompartment.reconfigure(
        createPluginRegistryField([
          makeBlockPlugin({ name: "theorem", numbered: false }),
        ]),
      ),
    });
    const counter2 = tr.state.field(blockCounterField);

    expect(counter1.blocks).toHaveLength(1);
    expect(tr.state.field(documentSemanticsField)).toBe(semantics1);
    expect(tr.state.field(pluginRegistryField)).not.toBe(registry1);
    expect(counter2).not.toBe(counter1);
    expect(counter2.blocks).toHaveLength(0);
  });

  it("recomputes when the effective numbering scheme changes", () => {
    const originalDoc = [
      "---",
      "title: AB",
      "numbering: global",
      "---",
      "::: {.theorem}",
      "Statement.",
      ":::",
      "",
      "::: {.definition}",
      "Definition.",
      ":::",
    ].join("\n");
    const nextDoc = originalDoc
      .replace("title: AB", "title: A")
      .replace("numbering: global", "numbering: grouped");
    const state = EditorState.create({
      doc: originalDoc,
      extensions: [
        markdown({ extensions: [fencedDiv] }),
        frontmatterField,
        documentSemanticsField,
        createPluginRegistryField([
          makeBlockPlugin({ name: "theorem", counter: "theorem" }),
          makeBlockPlugin({ name: "definition" }),
        ]),
        blockCounterField,
      ],
    });
    const counter1 = state.field(blockCounterField);
    const tr = state.update({
      changes: { from: 0, to: originalDoc.length, insert: nextDoc },
    });
    const counter2 = tr.state.field(blockCounterField);
    expect(counter1.blocks.map((block) => block.number)).toEqual([1, 2]);
    expect(counter2).not.toBe(counter1);
    expect(counter2.blocks.map((block) => block.number)).toEqual([1, 1]);
  });
});
