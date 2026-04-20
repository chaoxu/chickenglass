import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

function $printNode(node: LexicalNode, indent: number): string {
  const prefix = "  ".repeat(indent);
  const type = node.getType();
  const key = node.getKey();
  let line = `${prefix}(${type}) ${JSON.stringify(key)}`;

  if ($isTextNode(node)) {
    const text = node.getTextContent();
    line += ` ${JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}...` : text)}`;
  }

  const children = $isElementNode(node) ? node.getChildren() : [];
  const childLines = children.map((child) => $printNode(child, indent + 1));
  return [line, ...childLines].join("\n");
}

export function readLexicalTree(editor: LexicalEditor): string {
  let result = "";
  editor.read(() => {
    const root = $getRoot();
    const selection = $getSelection();
    const lines: string[] = [];
    lines.push(`(root) "${editor._config.namespace}"`);
    for (const child of root.getChildren()) {
      lines.push($printNode(child, 1));
    }
    if ($isRangeSelection(selection)) {
      lines.push(
        `\nselection: anchor=${selection.anchor.key}:${selection.anchor.offset} focus=${selection.focus.key}:${selection.focus.offset}`,
      );
    }
    result = lines.join("\n");
  });
  return result;
}
