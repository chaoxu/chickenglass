import { extractMarkdownBlocks } from "./labels";
import { maskMarkdownCodeSpansAndBlocks } from "./masking";

export interface MarkdownIncludeReference {
  readonly from: number;
  readonly path: string;
  readonly text: string;
  readonly to: number;
}

export function extractMarkdownIncludeReferences(
  content: string,
): readonly MarkdownIncludeReference[] {
  return extractMarkdownBlocks(content, maskMarkdownCodeSpansAndBlocks(content))
    .filter((block) => block.blockType === "include")
    .map((block) => ({
      from: block.from,
      path: block.content.trim(),
      text: content.slice(block.from, block.to),
      to: block.to,
    }))
    .filter((block) => block.path.length > 0);
}
