/**
 * Theorem-family block plugins.
 *
 * Theorem, lemma, corollary, proposition, and conjecture all share
 * a single counter group ("theorem"). They are numbered and render
 * with a bold header like "Theorem 1" or "Lemma 3 (Zorn)".
 */

import type { BlockPlugin } from "./plugin-types";
import { createBlockRender } from "./block-render";

/** Shared counter group for all theorem-family blocks. */
const THEOREM_COUNTER = "theorem";

export const theoremPlugin: BlockPlugin = {
  name: "theorem",
  counter: THEOREM_COUNTER,
  numbered: true,
  title: "Theorem",
  render: createBlockRender("Theorem"),
};

export const lemmaPlugin: BlockPlugin = {
  name: "lemma",
  counter: THEOREM_COUNTER,
  numbered: true,
  title: "Lemma",
  render: createBlockRender("Lemma"),
};

export const corollaryPlugin: BlockPlugin = {
  name: "corollary",
  counter: THEOREM_COUNTER,
  numbered: true,
  title: "Corollary",
  render: createBlockRender("Corollary"),
};

export const propositionPlugin: BlockPlugin = {
  name: "proposition",
  counter: THEOREM_COUNTER,
  numbered: true,
  title: "Proposition",
  render: createBlockRender("Proposition"),
};

export const conjecturePlugin: BlockPlugin = {
  name: "conjecture",
  counter: THEOREM_COUNTER,
  numbered: true,
  title: "Conjecture",
  render: createBlockRender("Conjecture"),
};

/** All theorem-family plugins as an array. */
export const theoremFamilyPlugins: readonly BlockPlugin[] = [
  theoremPlugin,
  lemmaPlugin,
  corollaryPlugin,
  propositionPlugin,
  conjecturePlugin,
];
