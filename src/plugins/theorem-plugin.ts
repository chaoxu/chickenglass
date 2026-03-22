/**
 * Theorem-family block plugins.
 *
 * Theorem, lemma, corollary, proposition, and conjecture all share
 * a single counter group ("theorem"). They are numbered and render
 * with a bold header like "Theorem 1" or "Lemma 3 (Zorn)".
 */

import type { BlockPlugin } from "./plugin-types";
import { createStandardPlugin } from "./plugin-factory";
import { THEOREM_COUNTER } from "../constants/block-manifest";

export const theoremPlugin: BlockPlugin = createStandardPlugin({
  name: "theorem",
  counter: THEOREM_COUNTER,
});

export const lemmaPlugin: BlockPlugin = createStandardPlugin({
  name: "lemma",
  counter: THEOREM_COUNTER,
});

export const corollaryPlugin: BlockPlugin = createStandardPlugin({
  name: "corollary",
  counter: THEOREM_COUNTER,
});

export const propositionPlugin: BlockPlugin = createStandardPlugin({
  name: "proposition",
  counter: THEOREM_COUNTER,
});

export const conjecturePlugin: BlockPlugin = createStandardPlugin({
  name: "conjecture",
  counter: THEOREM_COUNTER,
});

/** All theorem-family plugins as an array. */
export const theoremFamilyPlugins: readonly BlockPlugin[] = [
  theoremPlugin,
  lemmaPlugin,
  corollaryPlugin,
  propositionPlugin,
  conjecturePlugin,
];
