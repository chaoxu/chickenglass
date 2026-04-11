import {
  ElementNode,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedElementNode,
} from "lexical";

export class TableRowNode extends ElementNode {
  static getType(): string {
    return "coflat-table-row";
  }

  static clone(node: TableRowNode): TableRowNode {
    return new TableRowNode(node.__key);
  }

  static importJSON(serializedNode: SerializedElementNode): TableRowNode {
    return $createTableRowNode().updateFromJSON(serializedNode);
  }

  createDOM(): HTMLElement {
    return document.createElement("tr");
  }

  updateDOM(): false {
    return false;
  }

  canBeEmpty(): false {
    return false;
  }

  exportJSON(): SerializedElementNode {
    return {
      ...super.exportJSON(),
      type: "coflat-table-row",
      version: 1,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedElementNode>): this {
    return super.updateFromJSON(serializedNode);
  }
}

export function $createTableRowNode(key?: NodeKey): TableRowNode {
  return new TableRowNode(key);
}

export function $isTableRowNode(
  node: LexicalNode | null | undefined,
): node is TableRowNode {
  return node instanceof TableRowNode;
}
