import { $isCodeNode, type CodeNode } from "@lexical/code";
import {
  $generateJSONFromSelectedNodes,
  $getLexicalContent,
  type LexicalClipboardData,
} from "@lexical/clipboard";
import {
  $createParagraphNode,
  $getRoot,
  $isDecoratorNode,
  $isElementNode,
  $isRangeSelection,
  $parseSerializedNode,
  type BaseSelection,
  type LexicalEditor,
  type LexicalNode,
  type SerializedLexicalNode,
} from "lexical";

import {
  createHeadlessCoflatEditor,
  getLexicalMarkdown,
} from "./markdown";
import { renderMarkdownRichHtml } from "./rendering";
import type { LexicalRenderContextValue } from "./render-context";

export const COFLAT_MARKDOWN_MIME = "application/x-coflat-markdown";

export type ClipboardRenderContext = Pick<
  LexicalRenderContextValue,
  "citations" | "config" | "docPath" | "renderIndex" | "resolveAssetUrl"
>;

export type CoflatClipboardData = LexicalClipboardData & Partial<Record<typeof COFLAT_MARKDOWN_MIME, string>>;

function getCodeAncestor(node: LexicalNode): CodeNode | null {
  let current: LexicalNode | null = node;

  while (current) {
    if ($isCodeNode(current)) {
      return current;
    }
    current = current.getParent();
  }

  return null;
}

function getSingleSelectedCodeNode(selection: BaseSelection): CodeNode | null {
  if (!$isRangeSelection(selection)) {
    return null;
  }

  const nodes = selection.getNodes();
  if (nodes.length === 0) {
    return null;
  }

  let selectedCodeNode: CodeNode | null = null;

  for (const node of nodes) {
    const codeNode = getCodeAncestor(node);
    if (!codeNode) {
      return null;
    }

    if (!selectedCodeNode) {
      selectedCodeNode = codeNode;
      continue;
    }

    if (!selectedCodeNode.is(codeNode)) {
      return null;
    }
  }

  return selectedCodeNode;
}

function serializeCodeSelectionToMarkdown(codeNode: CodeNode, selectionText: string): string {
  const language = codeNode.getLanguage() ?? "";
  const header = language ? `\`\`\`${language}` : "```";
  const body = selectionText.endsWith("\n")
    ? selectionText
    : `${selectionText}\n`;

  return `${header}\n${body}\`\`\``;
}

function serializeSelectedNodesToMarkdown(nodes: readonly SerializedLexicalNode[]): string {
  const editor = createHeadlessCoflatEditor();
  editor.update(() => {
    const root = $getRoot();
    root.clear();

    let inlineNodes: LexicalNode[] = [];
    const flushInlineNodes = () => {
      if (inlineNodes.length === 0) {
        return;
      }

      const paragraph = $createParagraphNode();
      paragraph.append(...inlineNodes);
      root.append(paragraph);
      inlineNodes = [];
    };

    for (const serializedNode of nodes) {
      const node = $parseSerializedNode(serializedNode);
      const isBlockNode =
        ($isElementNode(node) && !node.isInline())
        || ($isDecoratorNode(node) && !node.isInline());

      if (isBlockNode) {
        flushInlineNodes();
        root.append(node);
        continue;
      }

      inlineNodes.push(node);
    }

    flushInlineNodes();
  }, { discrete: true });
  return getLexicalMarkdown(editor);
}

export function getCoflatClipboardData(
  editor: LexicalEditor,
  renderContext: ClipboardRenderContext,
  selection: BaseSelection | null,
): CoflatClipboardData | null {
  if (!selection) {
    return null;
  }

  if ($isRangeSelection(selection) && selection.isCollapsed()) {
    return null;
  }

  const selectedNodes = $generateJSONFromSelectedNodes<SerializedLexicalNode>(editor, selection).nodes;
  if (selectedNodes.length === 0) {
    return null;
  }

  const selectedCodeNode = getSingleSelectedCodeNode(selection);
  const markdown = selectedCodeNode
    ? serializeCodeSelectionToMarkdown(selectedCodeNode, selection.getTextContent())
    : serializeSelectedNodesToMarkdown(selectedNodes);
  const lexicalContent = $getLexicalContent(editor, selection);
  const plainText = selectedCodeNode
    ? selection.getTextContent()
    : markdown;
  const clipboardData: CoflatClipboardData = {
    [COFLAT_MARKDOWN_MIME]: markdown,
    "text/html": renderMarkdownRichHtml(markdown, {
      citations: renderContext.citations,
      config: renderContext.config,
      docPath: renderContext.docPath,
      renderIndex: renderContext.renderIndex,
      resolveAssetUrl: renderContext.resolveAssetUrl,
    }),
    "text/plain": plainText,
  };

  if (lexicalContent !== null) {
    clipboardData["application/x-lexical-editor"] = lexicalContent;
  }

  return clipboardData;
}
