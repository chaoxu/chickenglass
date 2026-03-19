/**
 * Algorithm block plugin.
 *
 * Algorithms have their own counter group ("algorithm"), separate
 * from both theorem-family and definition counters. They render
 * with a bold header like "Algorithm 1" or "Algorithm 2 (Dijkstra)".
 */

import type { BlockPlugin } from "./plugin-types";
import { createStandardPlugin } from "./plugin-factory";

export const algorithmPlugin: BlockPlugin = createStandardPlugin({
  name: "algorithm",
  counter: "algorithm",
});
