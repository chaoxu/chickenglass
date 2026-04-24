export { equationLabelExtension } from "./equation-label";
export { countColons, fencedDiv } from "./fenced-div";
export type { FencedDivAttrs } from "./fenced-div-attrs";
export { extractDivClass, parseFencedDivAttrs } from "./fenced-div-attrs";
export { footnoteExtension } from "./footnote";
export {
  type BlockConfig,
  extractRawFrontmatter,
  type FrontmatterConfig,
  type FrontmatterResult,
  type FrontmatterStatus,
  parseFrontmatter,
} from "./frontmatter";
export { highlightExtension } from "./highlight";
export { mathExtension } from "./math-backslash";
export { removeBlockquote } from "./remove-blockquote";
export { removeIndentedCode } from "./remove-indented-code";
export { strikethroughExtension } from "./strikethrough";
export { tableExtension } from "./table";

import { TaskList } from "@lezer/markdown";
import { equationLabelExtension } from "./equation-label";
import { fencedDiv } from "./fenced-div";
import { footnoteExtension } from "./footnote";
import { highlightExtension } from "./highlight";
import { mathExtension } from "./math-backslash";
import { removeBlockquote } from "./remove-blockquote";
import { removeIndentedCode } from "./remove-indented-code";
import { strikethroughExtension } from "./strikethrough";
import { tableExtension } from "./table";

/**
 * Shared Lezer markdown parser extensions used by both the CM6 editor
 * and the preview HTML renderer. Single source of truth — prevents
 * drift between what the editor parses and what Read mode renders.
 */
export const markdownExtensions = [
  removeIndentedCode,
  removeBlockquote,
  mathExtension,
  fencedDiv,
  equationLabelExtension,
  strikethroughExtension,
  highlightExtension,
  footnoteExtension,
  tableExtension,
  TaskList,
];

/**
 * Parser extensions for in-app preview renderers.
 *
 * Same as `markdownExtensions` but WITHOUT `removeBlockquote`, so that
 * standard `>` blockquote syntax is parsed into Blockquote nodes and
 * rendered as `<blockquote>` HTML. The editor removes blockquotes because
 * it uses fenced divs (`::: Blockquote`) instead, but hover/preview paths
 * must handle standard blockquote syntax from content.
 */
export const htmlRenderExtensions = [
  removeIndentedCode,
  mathExtension,
  fencedDiv,
  equationLabelExtension,
  strikethroughExtension,
  highlightExtension,
  footnoteExtension,
  tableExtension,
  TaskList,
];
