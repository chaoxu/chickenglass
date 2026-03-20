/**
 * Default block plugins for mathematical writing.
 *
 * Exports the full set of default plugins ready for registration.
 * Counter groups:
 * - "theorem": theorem, lemma, corollary, proposition, conjecture
 * - "definition": definition
 * - "algorithm": algorithm
 * - unnumbered: proof, remark, example, embed, iframe, youtube, gist
 */

import type { BlockPlugin } from "./plugin-types";
import { theoremFamilyPlugins } from "./theorem-plugin";
import { definitionPlugin } from "./definition-plugin";
import { proofPlugin } from "./proof-plugin";
import { remarkPlugin, examplePlugin } from "./remark-plugin";
import { algorithmPlugin } from "./algorithm-plugin";
import { problemPlugin } from "./problem-plugin";
import { embedFamilyPlugins } from "./embed-plugin";
import { blockquotePlugin } from "./blockquote-plugin";

/** All default block plugins as a single array. */
export const defaultPlugins: readonly BlockPlugin[] = [
  ...theoremFamilyPlugins,
  definitionPlugin,
  problemPlugin,
  proofPlugin,
  remarkPlugin,
  examplePlugin,
  algorithmPlugin,
  blockquotePlugin,
  ...embedFamilyPlugins,
];
