/**
 * Problem block plugin.
 *
 * Problems share the theorem-family counter group and render
 * with a bold header like "Problem 1" or "Problem 3 (Collatz)".
 */

import type { BlockPlugin } from "./plugin-types";
import { createStandardPlugin, THEOREM_COUNTER } from "./plugin-factory";

export const problemPlugin: BlockPlugin = createStandardPlugin({
  name: "problem",
  counter: THEOREM_COUNTER,
});
