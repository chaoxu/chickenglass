import { describe, expect, it } from "vitest";

import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { fencedDiv } from "../parser/fenced-div";

import {
  createRegistryState,
  registerPlugins,
  type PluginRegistryState,
} from "./plugin-registry";
import { computeBlockNumbers } from "./block-counter";
import { formatBlockHeader, createBlockRender } from "./block-render";

import {
  theoremPlugin,
  lemmaPlugin,
  corollaryPlugin,
  propositionPlugin,
  conjecturePlugin,
  theoremFamilyPlugins,
} from "./theorem-plugin";
import { proofPlugin, QED_SYMBOL } from "./proof-plugin";
import { definitionPlugin } from "./definition-plugin";
import { remarkPlugin, examplePlugin } from "./remark-plugin";
import { algorithmPlugin } from "./algorithm-plugin";
import { defaultPlugins } from "./default-plugins";

/** Create an EditorState with fenced div parser. */
function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: [fencedDiv] })],
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
    expect(result).toBe("Theorem 3 (Main Result)");
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
    expect(result).toBe("Proof (of Theorem 1)");
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
    expect(spec.className).toBe("cf-block cf-block-definition");
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
    expect(theoremPlugin.name).toBe("theorem");
    expect(theoremPlugin.title).toBe("Theorem");
  });

  it("lemmaPlugin has correct fields", () => {
    expect(lemmaPlugin.name).toBe("lemma");
    expect(lemmaPlugin.title).toBe("Lemma");
  });

  it("corollaryPlugin has correct fields", () => {
    expect(corollaryPlugin.name).toBe("corollary");
    expect(corollaryPlugin.title).toBe("Corollary");
  });

  it("propositionPlugin has correct fields", () => {
    expect(propositionPlugin.name).toBe("proposition");
    expect(propositionPlugin.title).toBe("Proposition");
  });

  it("conjecturePlugin has correct fields", () => {
    expect(conjecturePlugin.name).toBe("conjecture");
    expect(conjecturePlugin.title).toBe("Conjecture");
  });
});

describe("proofPlugin", () => {
  it("is unnumbered", () => {
    expect(proofPlugin.numbered).toBe(false);
  });

  it("has no counter", () => {
    expect(proofPlugin.counter).toBeUndefined();
  });

  it("has QED symbol in defaults", () => {
    expect(proofPlugin.defaults).toBeDefined();
    expect((proofPlugin.defaults as Record<string, unknown>)["qedSymbol"]).toBe(
      QED_SYMBOL,
    );
  });

  it("QED_SYMBOL is the tombstone character", () => {
    expect(QED_SYMBOL).toBe("\u220E");
  });

  it("renders with title when provided", () => {
    const spec = proofPlugin.render({
      type: "proof",
      title: "of Theorem 1",
    });
    expect(spec.header).toBe("Proof (of Theorem 1)");
    expect(spec.className).toBe("cf-block cf-block-proof");
  });

  it("renders without title", () => {
    const spec = proofPlugin.render({ type: "proof" });
    expect(spec.header).toBe("Proof");
  });
});

describe("definitionPlugin", () => {
  it("has its own counter group", () => {
    expect(definitionPlugin.counter).toBe("definition");
    expect(definitionPlugin.numbered).toBe(true);
  });

  it("renders correctly", () => {
    const spec = definitionPlugin.render({
      type: "definition",
      number: 1,
      title: "Continuity",
    });
    expect(spec.header).toBe("Definition 1 (Continuity)");
    expect(spec.className).toBe("cf-block cf-block-definition");
  });
});

describe("remarkPlugin", () => {
  it("is unnumbered", () => {
    expect(remarkPlugin.numbered).toBe(false);
  });

  it("has no counter", () => {
    expect(remarkPlugin.counter).toBeUndefined();
  });

  it("renders correctly", () => {
    const spec = remarkPlugin.render({ type: "remark" });
    expect(spec.header).toBe("Remark");
  });
});

describe("examplePlugin", () => {
  it("is unnumbered", () => {
    expect(examplePlugin.numbered).toBe(false);
  });

  it("has no counter", () => {
    expect(examplePlugin.counter).toBeUndefined();
  });

  it("renders correctly", () => {
    const spec = examplePlugin.render({
      type: "example",
      title: "Cantor's diagonal",
    });
    expect(spec.header).toBe("Example (Cantor's diagonal)");
  });
});

describe("algorithmPlugin", () => {
  it("has its own counter group", () => {
    expect(algorithmPlugin.counter).toBe("algorithm");
    expect(algorithmPlugin.numbered).toBe(true);
  });

  it("renders correctly", () => {
    const spec = algorithmPlugin.render({
      type: "algorithm",
      number: 2,
      title: "Dijkstra",
    });
    expect(spec.header).toBe("Algorithm 2 (Dijkstra)");
    expect(spec.className).toBe("cf-block cf-block-algorithm");
  });
});

// ---------------------------------------------------------------------------
// defaultPlugins collection
// ---------------------------------------------------------------------------

describe("defaultPlugins", () => {
  it("contains all 16 default plugins", () => {
    expect(defaultPlugins).toHaveLength(16);
  });

  it("includes all expected plugin names", () => {
    const names = defaultPlugins.map((p) => p.name);
    expect(names).toContain("theorem");
    expect(names).toContain("lemma");
    expect(names).toContain("corollary");
    expect(names).toContain("proposition");
    expect(names).toContain("conjecture");
    expect(names).toContain("definition");
    expect(names).toContain("problem");
    expect(names).toContain("proof");
    expect(names).toContain("remark");
    expect(names).toContain("example");
    expect(names).toContain("algorithm");
    expect(names).toContain("blockquote");
    expect(names).toContain("embed");
    expect(names).toContain("iframe");
    expect(names).toContain("youtube");
    expect(names).toContain("gist");
  });

  it("has no duplicate names", () => {
    const names = defaultPlugins.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
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
    const spec = theoremPlugin.render({
      type: "theorem",
      number: 1,
      title: "Fermat's Last",
    });
    expect(spec.className).toBe("cf-block cf-block-theorem");
    expect(spec.header).toBe("Theorem 1 (Fermat's Last)");
  });

  it("lemma renders with number", () => {
    const spec = lemmaPlugin.render({ type: "lemma", number: 5 });
    expect(spec.header).toBe("Lemma 5");
  });

  it("corollary renders with number", () => {
    const spec = corollaryPlugin.render({ type: "corollary", number: 2 });
    expect(spec.header).toBe("Corollary 2");
  });

  it("proposition renders with number and title", () => {
    const spec = propositionPlugin.render({
      type: "proposition",
      number: 3,
      title: "Key step",
    });
    expect(spec.header).toBe("Proposition 3 (Key step)");
  });

  it("conjecture renders with number", () => {
    const spec = conjecturePlugin.render({ type: "conjecture", number: 1 });
    expect(spec.header).toBe("Conjecture 1");
  });

  it("proof renders without number", () => {
    const spec = proofPlugin.render({ type: "proof" });
    expect(spec.header).toBe("Proof");
    expect(spec.className).toBe("cf-block cf-block-proof");
  });

  it("definition renders with number", () => {
    const spec = definitionPlugin.render({ type: "definition", number: 4 });
    expect(spec.header).toBe("Definition 4");
  });

  it("remark renders without number", () => {
    const spec = remarkPlugin.render({ type: "remark" });
    expect(spec.header).toBe("Remark");
  });

  it("example renders without number but with title", () => {
    const spec = examplePlugin.render({
      type: "example",
      title: "A simple case",
    });
    expect(spec.header).toBe("Example (A simple case)");
  });

  it("algorithm renders with number", () => {
    const spec = algorithmPlugin.render({ type: "algorithm", number: 1 });
    expect(spec.header).toBe("Algorithm 1");
  });

  it("all plugins produce correct CSS class pattern", () => {
    for (const plugin of defaultPlugins) {
      const spec = plugin.render({
        type: plugin.name,
        number: plugin.numbered ? 1 : undefined,
      });
      expect(spec.className).toBe(`cf-block cf-block-${plugin.name}`);
    }
  });
});
