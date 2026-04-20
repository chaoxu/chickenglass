import { describe, expect, it } from "vitest";

import { markdown } from "@codemirror/lang-markdown";
import { fencedDiv } from "../parser/fenced-div";
import { documentSemanticsField } from "../state/document-analysis";
import { CSS } from "../constants/css-classes";
import { createEditorState } from "../test-utils";

import {
  createRegistryState,
  registerPlugins,
  type PluginRegistryState,
} from "./plugin-registry";
import { computeBlockNumbers } from "./block-counter";
import { formatBlockHeader, createBlockRender } from "./block-render";
import { defaultPlugins, theoremFamilyPlugins } from "./default-plugins";
import { QED_SYMBOL } from "./proof-plugin";
import { BLOCK_MANIFEST, EXCLUDED_FROM_FALLBACK } from "../constants/block-manifest";

/** Look up a default plugin by name. */
function pluginByName(name: string) {
  const p = defaultPlugins.find((p) => p.name === name);
  if (!p) throw new Error(`No plugin named "${name}"`);
  return p;
}

/** Create an EditorState with fenced div parser. */
function createState(doc: string) {
  return createEditorState(doc, {
    extensions: [
      markdown({ extensions: [fencedDiv] }),
      documentSemanticsField,
    ],
  });
}

/** Create a registry loaded with all default plugins. */
function defaultRegistry(): PluginRegistryState {
  return registerPlugins(createRegistryState(), defaultPlugins);
}

// ---------------------------------------------------------------------------
// block-render utilities
// ---------------------------------------------------------------------------

describe("formatBlockHeader", () => {
  it("formats numbered block with title", () => {
    const result = formatBlockHeader("Theorem", {
      type: "theorem",
      number: 3,
      title: "Main Result",
    });
    expect(result).toBe("Theorem 3");
  });

  it("formats numbered block without title", () => {
    const result = formatBlockHeader("Lemma", {
      type: "lemma",
      number: 1,
    });
    expect(result).toBe("Lemma 1");
  });

  it("formats unnumbered block with title", () => {
    const result = formatBlockHeader("Proof", {
      type: "proof",
      title: "of Theorem 1",
    });
    expect(result).toBe("Proof");
  });

  it("formats unnumbered block without title", () => {
    const result = formatBlockHeader("Remark", { type: "remark" });
    expect(result).toBe("Remark");
  });
});

describe("createBlockRender", () => {
  it("returns a render function that produces correct spec", () => {
    const render = createBlockRender("Definition");
    const spec = render({ type: "definition", number: 2 });
    expect(spec.className).toBe(CSS.block("definition"));
    expect(spec.header).toBe("Definition 2");
  });
});

// ---------------------------------------------------------------------------
// Individual plugin shape
// ---------------------------------------------------------------------------

describe("theorem-family plugins", () => {
  it("exports five plugins sharing the theorem counter", () => {
    expect(theoremFamilyPlugins).toHaveLength(5);
    for (const plugin of theoremFamilyPlugins) {
      expect(plugin.counter).toBe("theorem");
      expect(plugin.numbered).toBe(true);
    }
  });

  it("theoremPlugin has correct fields", () => {
    const theorem = pluginByName("theorem");
    expect(theorem.name).toBe("theorem");
    expect(theorem.title).toBe("Theorem");
  });

  it("lemmaPlugin has correct fields", () => {
    const lemma = pluginByName("lemma");
    expect(lemma.name).toBe("lemma");
    expect(lemma.title).toBe("Lemma");
  });

  it("corollaryPlugin has correct fields", () => {
    const corollary = pluginByName("corollary");
    expect(corollary.name).toBe("corollary");
    expect(corollary.title).toBe("Corollary");
  });

  it("propositionPlugin has correct fields", () => {
    const proposition = pluginByName("proposition");
    expect(proposition.name).toBe("proposition");
    expect(proposition.title).toBe("Proposition");
  });

  it("conjecturePlugin has correct fields", () => {
    const conjecture = pluginByName("conjecture");
    expect(conjecture.name).toBe("conjecture");
    expect(conjecture.title).toBe("Conjecture");
  });
});

describe("proofPlugin", () => {
  const proof = pluginByName("proof");

  it("is unnumbered", () => {
    expect(proof.numbered).toBe(false);
  });

  it("has no counter", () => {
    expect(proof.counter).toBeUndefined();
  });

  it("QED_SYMBOL is the tombstone character", () => {
    expect(QED_SYMBOL).toBe("\u220E");
  });

  it("renders with title when provided", () => {
    const spec = proof.render({
      type: "proof",
      title: "of Theorem 1",
    });
    expect(spec.header).toBe("Proof");
    expect(spec.className).toBe(CSS.block("proof"));
  });

  it("renders without title", () => {
    const spec = proof.render({ type: "proof" });
    expect(spec.header).toBe("Proof");
  });
});

describe("definitionPlugin", () => {
  const definition = pluginByName("definition");

  it("has its own counter group", () => {
    expect(definition.counter).toBe("definition");
    expect(definition.numbered).toBe(true);
  });

  it("renders correctly", () => {
    const spec = definition.render({
      type: "definition",
      number: 1,
      title: "Continuity",
    });
    expect(spec.header).toBe("Definition 1");
    expect(spec.className).toBe(CSS.block("definition"));
  });
});

describe("remarkPlugin", () => {
  const remark = pluginByName("remark");

  it("is unnumbered", () => {
    expect(remark.numbered).toBe(false);
  });

  it("has no counter", () => {
    expect(remark.counter).toBeUndefined();
  });

  it("renders correctly", () => {
    const spec = remark.render({ type: "remark" });
    expect(spec.header).toBe("Remark");
  });
});

describe("examplePlugin", () => {
  const example = pluginByName("example");

  it("is unnumbered", () => {
    expect(example.numbered).toBe(false);
  });

  it("has no counter", () => {
    expect(example.counter).toBeUndefined();
  });

  it("renders correctly", () => {
    const spec = example.render({
      type: "example",
      title: "Cantor's diagonal",
    });
    expect(spec.header).toBe("Example");
  });
});

describe("algorithmPlugin", () => {
  const algorithm = pluginByName("algorithm");

  it("has its own counter group", () => {
    expect(algorithm.counter).toBe("algorithm");
    expect(algorithm.numbered).toBe(true);
  });

  it("renders correctly", () => {
    const spec = algorithm.render({
      type: "algorithm",
      number: 2,
      title: "Dijkstra",
    });
    expect(spec.header).toBe("Algorithm 2");
    expect(spec.className).toBe(CSS.block("algorithm"));
  });
});

// ---------------------------------------------------------------------------
// defaultPlugins collection
// ---------------------------------------------------------------------------

describe("defaultPlugins", () => {
  it("has one plugin per manifest entry", () => {
    expect(defaultPlugins).toHaveLength(BLOCK_MANIFEST.length);
  });

  it("matches manifest order", () => {
    const manifestNames = BLOCK_MANIFEST.map((e) => e.name);
    const pluginNames = defaultPlugins.map((p) => p.name);
    expect(pluginNames).toEqual(manifestNames);
  });

  it("has no duplicate names", () => {
    const names = defaultPlugins.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("EXCLUDED_FROM_FALLBACK", () => {
  it("does not special-case any block names", () => {
    expect(EXCLUDED_FROM_FALLBACK.size).toBe(0);
  });

  it("does not contain any manifest block names", () => {
    for (const entry of BLOCK_MANIFEST) {
      expect(EXCLUDED_FROM_FALLBACK.has(entry.name)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Shared counter behavior (integration with block-counter)
// ---------------------------------------------------------------------------

describe("shared counters", () => {
  it("theorem and lemma share a counter", () => {
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
    const registry = defaultRegistry();
    const result = computeBlockNumbers(state, registry);

    expect(result.blocks).toHaveLength(3);
    expect(result.blocks[0].type).toBe("theorem");
    expect(result.blocks[0].number).toBe(1);
    expect(result.blocks[1].type).toBe("lemma");
    expect(result.blocks[1].number).toBe(2);
    expect(result.blocks[2].type).toBe("theorem");
    expect(result.blocks[2].number).toBe(3);
  });

  it("all five theorem-family types share a counter", () => {
    const doc = [
      "::: {.theorem}",
      "T.",
      ":::",
      "",
      "::: {.lemma}",
      "L.",
      ":::",
      "",
      "::: {.corollary}",
      "C.",
      ":::",
      "",
      "::: {.proposition}",
      "P.",
      ":::",
      "",
      "::: {.conjecture}",
      "J.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = defaultRegistry();
    const result = computeBlockNumbers(state, registry);

    expect(result.blocks).toHaveLength(5);
    expect(result.blocks[0].number).toBe(1); // theorem
    expect(result.blocks[1].number).toBe(2); // lemma
    expect(result.blocks[2].number).toBe(3); // corollary
    expect(result.blocks[3].number).toBe(4); // proposition
    expect(result.blocks[4].number).toBe(5); // conjecture
  });

  it("definition has a separate counter from theorem", () => {
    const doc = [
      "::: {.theorem}",
      "T1.",
      ":::",
      "",
      "::: {.definition}",
      "D1.",
      ":::",
      "",
      "::: {.theorem}",
      "T2.",
      ":::",
      "",
      "::: {.definition}",
      "D2.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = defaultRegistry();
    const result = computeBlockNumbers(state, registry);

    expect(result.blocks).toHaveLength(4);
    expect(result.blocks[0].type).toBe("theorem");
    expect(result.blocks[0].number).toBe(1);
    expect(result.blocks[1].type).toBe("definition");
    expect(result.blocks[1].number).toBe(1);
    expect(result.blocks[2].type).toBe("theorem");
    expect(result.blocks[2].number).toBe(2);
    expect(result.blocks[3].type).toBe("definition");
    expect(result.blocks[3].number).toBe(2);
  });

  it("algorithm has a separate counter from theorem and definition", () => {
    const doc = [
      "::: {.theorem}",
      "T1.",
      ":::",
      "",
      "::: {.algorithm}",
      "A1.",
      ":::",
      "",
      "::: {.definition}",
      "D1.",
      ":::",
      "",
      "::: {.algorithm}",
      "A2.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = defaultRegistry();
    const result = computeBlockNumbers(state, registry);

    expect(result.blocks).toHaveLength(4);
    expect(result.blocks[0].number).toBe(1); // theorem 1
    expect(result.blocks[1].number).toBe(1); // algorithm 1
    expect(result.blocks[2].number).toBe(1); // definition 1
    expect(result.blocks[3].number).toBe(2); // algorithm 2
  });

  it("proof, remark, and example are not numbered", () => {
    const doc = [
      "::: {.proof}",
      "A proof.",
      ":::",
      "",
      "::: {.remark}",
      "A remark.",
      ":::",
      "",
      "::: {.example}",
      "An example.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = defaultRegistry();
    const result = computeBlockNumbers(state, registry);

    expect(result.blocks).toHaveLength(0);
  });

  it("unnumbered blocks do not affect numbered counters", () => {
    const doc = [
      "::: {.theorem}",
      "T1.",
      ":::",
      "",
      "::: {.proof}",
      "Proof of T1.",
      ":::",
      "",
      "::: {.remark}",
      "A remark.",
      ":::",
      "",
      "::: {.theorem}",
      "T2.",
      ":::",
    ].join("\n");

    const state = createState(doc);
    const registry = defaultRegistry();
    const result = computeBlockNumbers(state, registry);

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].type).toBe("theorem");
    expect(result.blocks[0].number).toBe(1);
    expect(result.blocks[1].type).toBe("theorem");
    expect(result.blocks[1].number).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Rendering output
// ---------------------------------------------------------------------------

describe("rendering", () => {
  it("theorem renders with number and title", () => {
    const theorem = pluginByName("theorem");
    const spec = theorem.render({
      type: "theorem",
      number: 1,
      title: "Fermat's Last",
    });
    expect(spec.className).toBe(CSS.block("theorem"));
    expect(spec.header).toBe("Theorem 1");
  });

  it("lemma renders with number", () => {
    const spec = pluginByName("lemma").render({ type: "lemma", number: 5 });
    expect(spec.header).toBe("Lemma 5");
  });

  it("corollary renders with number", () => {
    const spec = pluginByName("corollary").render({ type: "corollary", number: 2 });
    expect(spec.header).toBe("Corollary 2");
  });

  it("proposition renders with number and title", () => {
    const spec = pluginByName("proposition").render({
      type: "proposition",
      number: 3,
      title: "Key step",
    });
    expect(spec.header).toBe("Proposition 3");
  });

  it("conjecture renders with number", () => {
    const spec = pluginByName("conjecture").render({ type: "conjecture", number: 1 });
    expect(spec.header).toBe("Conjecture 1");
  });

  it("proof renders without number", () => {
    const spec = pluginByName("proof").render({ type: "proof" });
    expect(spec.header).toBe("Proof");
    expect(spec.className).toBe(CSS.block("proof"));
  });

  it("definition renders with number", () => {
    const spec = pluginByName("definition").render({ type: "definition", number: 4 });
    expect(spec.header).toBe("Definition 4");
  });

  it("remark renders without number", () => {
    const spec = pluginByName("remark").render({ type: "remark" });
    expect(spec.header).toBe("Remark");
  });

  it("example renders without number but with title", () => {
    const spec = pluginByName("example").render({
      type: "example",
      title: "A simple case",
    });
    expect(spec.header).toBe("Example");
  });

  it("algorithm renders with number", () => {
    const spec = pluginByName("algorithm").render({ type: "algorithm", number: 1 });
    expect(spec.header).toBe("Algorithm 1");
  });

  it("all plugins produce correct CSS class pattern", () => {
    for (const plugin of defaultPlugins) {
      const spec = plugin.render({
        type: plugin.name,
        number: plugin.numbered ? 1 : undefined,
      });
      expect(spec.className).toBe(CSS.block(plugin.name));
    }
  });

  describe("negative / edge-case", () => {
    it("numbered plugin omits number when number is undefined", () => {
      const spec = pluginByName("theorem").render({ type: "theorem" });
      // Header should still be "Theorem" without a trailing number
      expect(spec.header).toBe("Theorem");
    });

    it("unnumbered plugin still renders if number is explicitly passed", () => {
      // proofPlugin.numbered === false, but the render function does not filter
      // number from attrs — that's the caller's responsibility. The header
      // just shows whatever number is passed.
      const spec = pluginByName("proof").render({ type: "proof", number: 99 });
      expect(spec.header).toBe("Proof 99");
    });

    it("algorithm render with number 0 does not crash", () => {
      const spec = pluginByName("algorithm").render({ type: "algorithm", number: 0 });
      expect(spec.header).toBe("Algorithm 0");
    });

    it("definition render with very large number does not crash", () => {
      const spec = pluginByName("definition").render({ type: "definition", number: 9999 });
      expect(spec.header).toBe("Definition 9999");
    });
  });
});
