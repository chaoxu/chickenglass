/**
 * Figure block plugin.
 *
 * Renders `::: {.figure #fig-id} Caption text` as a numbered figure
 * with the caption below the content. Counter group: "figure".
 */

import type { BlockPlugin } from "./plugin-types";
import { createStandardPlugin } from "./plugin-factory";
import { FIGURE_COUNTER } from "../constants/block-manifest";

export const figurePlugin: BlockPlugin = createStandardPlugin({
  name: "figure",
  counter: FIGURE_COUNTER,
  captionPosition: "below",
});
