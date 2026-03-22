/**
 * Definition block plugin.
 *
 * Definitions have their own counter group ("definition"), separate
 * from the theorem-family counter. They render with a bold header
 * like "Definition 1" or "Definition 2 (Continuity)".
 */

import type { BlockPlugin } from "./plugin-types";
import { createStandardPlugin } from "./plugin-factory";
import { DEFINITION_COUNTER } from "../constants/block-manifest";

export const definitionPlugin: BlockPlugin = createStandardPlugin({
  name: "definition",
  counter: DEFINITION_COUNTER,
});
