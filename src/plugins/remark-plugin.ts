/**
 * Remark and example block plugins.
 *
 * Both are unnumbered. They render with a simple header
 * like "Remark" or "Example (Cantor's diagonal)".
 */

import type { BlockPlugin } from "./plugin-types";
import { createStandardPlugin } from "./plugin-factory";

export const remarkPlugin: BlockPlugin = createStandardPlugin({
  name: "remark",
  numbered: false,
});

export const examplePlugin: BlockPlugin = createStandardPlugin({
  name: "example",
  numbered: false,
});
