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
  $selectFirstTableCell,
  activateInsertedBlock,
  ensureTrailingParagraph,
} from "./block-insert-focus";
import {
  createFencedDivInsertSpec,
  createFootnoteDefinitionInsertSpec,
  createImageInsertSpec,
  createTableInsertSpec,
  DISPLAY_MATH_BRACKET_INSERT_SPEC,
  DISPLAY_MATH_DOLLAR_INSERT_SPEC,
  FRONTMATTER_INSERT_SPEC,
  type BlockInsertSpec,
} from "./block-insert-catalog";
import { createInsertBlockNode } from "./block-insert-node";
import {
  FOOTNOTE_DEFINITION_START_RE,
  IMAGE_BLOCK_START_RE,
  isDisplayMathBracketExpansionLine,
  isDisplayMathDollarExpansionLine,
  matchFencedDivStartLine,
  TABLE_DIVIDER_RE,
} from "./markdown/block-scanner";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";

interface ExpansionCandidate extends BlockInsertSpec {
  readonly replaceNodes: readonly LexicalNode[];
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

function withReplacement(
  spec: BlockInsertSpec,
  replaceNodes: readonly LexicalNode[],
): ExpansionCandidate {
  return {
    ...spec,
    replaceNodes,
  };
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
    return withReplacement(FRONTMATTER_INSERT_SPEC, [paragraph]);
  }

  if (isDisplayMathDollarExpansionLine(text)) {
    return withReplacement(DISPLAY_MATH_DOLLAR_INSERT_SPEC, [paragraph]);
  }

  if (isDisplayMathBracketExpansionLine(text)) {
    return withReplacement(DISPLAY_MATH_BRACKET_INSERT_SPEC, [paragraph]);
  }

  if (matchFencedDivStartLine(text, { requireHeader: true })) {
    return withReplacement(createFencedDivInsertSpec(text), [paragraph]);
  }

  if (FOOTNOTE_DEFINITION_START_RE.test(text)) {
    return withReplacement(createFootnoteDefinitionInsertSpec(text), [paragraph]);
  }

  if (IMAGE_BLOCK_START_RE.test(text)) {
    return withReplacement(createImageInsertSpec(text), [paragraph]);
  }

  const previousSibling = paragraph.getPreviousSibling();
  if (
    previousSibling
    && previousSibling.getType() === "paragraph"
    && TABLE_DIVIDER_RE.test(text)
  ) {
    const headerLine = previousSibling.getTextContent();
    if (headerLine.includes("|")) {
      return withReplacement(createTableInsertSpec(headerLine, text), [previousSibling, paragraph]);
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
    const insertedNode = createInsertBlockNode(candidate.variant, candidate.raw);
    if (!insertedNode) {
      return;
    }
    insertedNodeKey = insertedNode.getKey();
    firstNode.insertBefore(insertedNode);
    for (const node of candidate.replaceNodes) {
      node.remove();
    }
    ensureTrailingParagraph(insertedNode, afterNode);
    if (candidate.focusTarget === "table-cell") {
      $selectFirstTableCell(insertedNode);
    }

    activateInsertedBlock(editor, insertedNodeKey, candidate.focusTarget);
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
      insertExpandedBlock(editor, candidate);
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  ), [editor]);

  return null;
}
