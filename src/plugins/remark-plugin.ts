/**
 * Remark and example block plugins.
 *
 * Both are unnumbered. They render with a simple header
 * like "Remark" or "Example (Cantor's diagonal)".
 */

import type { BlockPlugin } from "./plugin-types";
import { createBlockRender } from "./block-render";

export const remarkPlugin: BlockPlugin = {
  name: "remark",
  numbered: false,
  title: "Remark",
  render: createBlockRender("Remark"),
};

export const examplePlugin: BlockPlugin = {
  name: "example",
  numbered: false,
  title: "Example",
  render: createBlockRender("Example"),
};
