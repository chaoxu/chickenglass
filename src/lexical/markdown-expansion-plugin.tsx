import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type RangeSelection,
} from "lexical";

import {
  activateInsertedBlock,
  ensureTrailingParagraph,
  type InsertFocusTarget,
} from "./block-insert-focus";
import { $createRawBlockNode, type RawBlockVariant } from "./nodes/raw-block-node";
import { createTableNodeFromMarkdown } from "./markdown";
import { queueEmbeddedSurfaceFocus } from "./pending-surface-focus";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";

const FENCED_DIV_START_RE = /^\s*(:{3,})(.*)$/;
const DISPLAY_MATH_DOLLAR_RE = /^\s*\$\$\s*$/;
const DISPLAY_MATH_BRACKET_RE = /^\s*\\\[\s*$/;
const FOOTNOTE_DEFINITION_RE = /^\[\^[^\]]+\]:\s*(.*)$/;
const IMAGE_BLOCK_RE = /^\s*!\[[^\]\n]*\]\([^)]+\)\s*$/;
const TABLE_DIVIDER_RE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/;

interface ExpansionCandidate {
  readonly focusTarget: InsertFocusTarget;
  readonly raw: string;
  readonly replaceNodes: readonly LexicalNode[];
  readonly variant: RawBlockVariant | "table";
}

function getSelectionParagraph(selection: RangeSelection): ElementNode | null {
  if (!selection.isCollapsed()) {
    return null;
  }

  const anchorNode = selection.anchor.getNode();
  const topLevelNode = anchorNode.getTopLevelElement();
  return topLevelNode && topLevelNode.getType() === "paragraph"
    ? topLevelNode
    : null;
}

function isFirstTopLevelNode(node: LexicalNode): boolean {
  return node.getPreviousSibling() === null;
}

function buildTablePlaceholderRow(headerLine: string): string {
  const cells = headerLine
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);

  if (cells.length === 0) {
    return "|  |";
  }

  return `| ${cells.map(() => "").join(" | ")} |`;
}

export function getMarkdownExpansionCandidate(selection: RangeSelection): ExpansionCandidate | null {
  const paragraph = getSelectionParagraph(selection);
  if (!paragraph) {
    return null;
  }

  const text = paragraph.getTextContent();
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed === "---" && isFirstTopLevelNode(paragraph)) {
    return {
      focusTarget: "frontmatter",
      raw: "---\ntitle: \n---",
      replaceNodes: [paragraph],
      variant: "frontmatter",
    };
  }

  if (DISPLAY_MATH_DOLLAR_RE.test(text)) {
    return {
      focusTarget: "display-math",
      raw: "$$\n\n$$",
      replaceNodes: [paragraph],
      variant: "display-math",
    };
  }

  if (DISPLAY_MATH_BRACKET_RE.test(text)) {
    return {
      focusTarget: "display-math",
      raw: "\\[\n\n\\]",
      replaceNodes: [paragraph],
      variant: "display-math",
    };
  }

  const fencedDivMatch = text.match(FENCED_DIV_START_RE);
  if (fencedDivMatch && (fencedDivMatch[1]?.length ?? 0) >= 3) {
    const closingFence = ":".repeat(fencedDivMatch[1]?.length ?? 3);
    const focusTarget = /\{[^}]*\.include\b/.test(text) ? "include-path" : "block-body";
    return {
      focusTarget,
      raw: `${text}\n\n${closingFence}`,
      replaceNodes: [paragraph],
      variant: "fenced-div",
    };
  }

  if (FOOTNOTE_DEFINITION_RE.test(text)) {
    return {
      focusTarget: "footnote-body",
      raw: text,
      replaceNodes: [paragraph],
      variant: "footnote-definition",
    };
  }

  if (IMAGE_BLOCK_RE.test(text)) {
    return {
      focusTarget: "none",
      raw: text,
      replaceNodes: [paragraph],
      variant: "image",
    };
  }

  const previousSibling = paragraph.getPreviousSibling();
  if (
    previousSibling
    && previousSibling.getType() === "paragraph"
    && TABLE_DIVIDER_RE.test(text)
  ) {
    const headerLine = previousSibling.getTextContent();
    if (headerLine.includes("|")) {
      return {
        focusTarget: "table-cell",
        raw: `${headerLine}\n${text}\n${buildTablePlaceholderRow(headerLine)}`,
        replaceNodes: [previousSibling, paragraph],
        variant: "table",
      };
    }
  }

  return null;
}

function insertExpandedBlock(
  editor: LexicalEditor,
  candidate: ExpansionCandidate,
): NodeKey | null {
  let insertedNodeKey: NodeKey | null = null;

  editor.update(() => {
    const firstNode = candidate.replaceNodes[0];
    const lastNode = candidate.replaceNodes[candidate.replaceNodes.length - 1];
    const afterNode = lastNode?.getNextSibling() ?? null;
    const insertedNode = candidate.variant === "table"
      ? createTableNodeFromMarkdown(candidate.raw)
      : $createRawBlockNode(candidate.variant, candidate.raw);
    if (!insertedNode) {
      return;
    }
    insertedNodeKey = insertedNode.getKey();
    if (candidate.focusTarget === "block-body" || candidate.focusTarget === "footnote-body") {
      queueEmbeddedSurfaceFocus(editor.getKey(), insertedNodeKey, candidate.focusTarget, "end");
    }

    firstNode.insertBefore(insertedNode);
    for (const node of candidate.replaceNodes) {
      node.remove();
    }
    ensureTrailingParagraph(insertedNode, afterNode);
  }, {
    discrete: true,
    tag: COFLAT_NESTED_EDIT_TAG,
  });

  return insertedNodeKey;
}

export function MarkdownExpansionPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => editor.registerCommand(
    KEY_ENTER_COMMAND,
    (event) => {
      const candidate = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return null;
        }
        return getMarkdownExpansionCandidate(selection);
      });

      if (!candidate) {
        return false;
      }

      (event as KeyboardEvent | null)?.preventDefault();
      const insertedNodeKey = insertExpandedBlock(editor, candidate);
      if (insertedNodeKey) {
        activateInsertedBlock(editor, insertedNodeKey, candidate.focusTarget);
      }
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  ), [editor]);

  return null;
}
