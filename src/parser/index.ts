export { removeIndentedCode } from "./remove-indented-code";
export { removeBlockquote } from "./remove-blockquote";
export { mathExtension } from "./math-backslash";
export { fencedDiv } from "./fenced-div";
export { parseFencedDivAttrs, extractDivClass } from "./fenced-div-attrs";
export type { FencedDivAttrs } from "./fenced-div-attrs";
export {
  extractRawFrontmatter,
  parseFrontmatter,
  type BlockConfig,
  type FrontmatterConfig,
  type FrontmatterResult,
} from "./frontmatter";
export { equationLabelExtension } from "./equation-label";
export { strikethroughExtension } from "./strikethrough";
export { highlightExtension } from "./highlight";
export { footnoteExtension } from "./footnote";
import { Table, TaskList } from "@lezer/markdown";
import { removeIndentedCode } from "./remove-indented-code";
import { removeBlockquote } from "./remove-blockquote";
import { mathExtension } from "./math-backslash";
import { fencedDiv } from "./fenced-div";
import { equationLabelExtension } from "./equation-label";
import { strikethroughExtension } from "./strikethrough";
import { highlightExtension } from "./highlight";
import { footnoteExtension } from "./footnote";

/**
 * Shared Lezer markdown parser extensions used by both the CM6 editor
 * and the standalone HTML renderer. Single source of truth — prevents
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
  Table,
  TaskList,
];
