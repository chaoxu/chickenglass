/**
 * Definition block plugin.
 *
 * Definitions have their own counter group ("definition"), separate
 * from the theorem-family counter. They render with a bold header
 * like "Definition 1" or "Definition 2 (Continuity)".
 */

import type { BlockPlugin } from "./plugin-types";
import { createBlockRender } from "./block-render";

export const definitionPlugin: BlockPlugin = {
  name: "definition",
  counter: "definition",
  numbered: true,
  title: "Definition",
  render: createBlockRender("Definition"),
};
