import type { LexicalNode } from "lexical";

import { createTableNodeFromMarkdown } from "./markdown";
import { $createRawBlockNode, type RawBlockVariant } from "./nodes/raw-block-node";

export type InsertBlockVariant = RawBlockVariant | "table";

export function createInsertBlockNode(
  variant: InsertBlockVariant,
  raw: string,
): LexicalNode | null {
  if (variant === "table") {
    return createTableNodeFromMarkdown(raw);
  }
  return $createRawBlockNode(variant, raw);
}
