/**
 * Table block plugin.
 *
 * Renders `::: {.table #tbl-id} Caption text` as a numbered table
 * with the caption below the content. Counter group: "table".
 */

import type { BlockPlugin } from "./plugin-types";
import { createStandardPlugin } from "./plugin-factory";
import { TABLE_COUNTER } from "../constants/block-manifest";

export const tableBlockPlugin: BlockPlugin = createStandardPlugin({
  name: "table",
  counter: TABLE_COUNTER,
  captionPosition: "below",
});
