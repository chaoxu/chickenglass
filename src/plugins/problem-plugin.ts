/**
 * Problem block plugin.
 *
 * Problems share the theorem-family counter group and render
 * with a bold header like "Problem 1" or "Problem 3 (Collatz)".
 */

import type { BlockPlugin } from "./plugin-types";
import { createBlockRender } from "./block-render";

export const problemPlugin: BlockPlugin = {
  name: "problem",
  counter: "theorem",
  numbered: true,
  title: "Problem",
  render: createBlockRender("Problem"),
};
