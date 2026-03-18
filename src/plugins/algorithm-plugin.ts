/**
 * Algorithm block plugin.
 *
 * Algorithms have their own counter group ("algorithm"), separate
 * from both theorem-family and definition counters. They render
 * with a bold header like "Algorithm 1" or "Algorithm 2 (Dijkstra)".
 */

import type { BlockPlugin } from "./plugin-types";
import { createBlockRender } from "./block-render";

export const algorithmPlugin: BlockPlugin = {
  name: "algorithm",
  counter: "algorithm",
  numbered: true,
  title: "Algorithm",
  render: createBlockRender("Algorithm"),
};
