import {
  ElementNode,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
} from "lexical";
import { LEXICAL_NODE_CLASS } from "../../constants/lexical-css-classes";
import { BLOCK_KEYBOARD_ENTRY_ATTRIBUTE } from "../block-keyboard-entry";

export type SerializedTableCellNode = Spread<{
  header: boolean;
}, SerializedElementNode>;

function syncTableCellDom(
  node: TableCellNode,
  dom: HTMLElement,
): void {
  dom.dataset.coflatTableCell = node.isHeader() ? "header" : "body";
  dom.classList.add(LEXICAL_NODE_CLASS.TABLE_CELL);
  if (node.isHeader()) {
    dom.classList.add(LEXICAL_NODE_CLASS.TABLE_CELL_HEADER);
    dom.setAttribute("scope", "col");
  } else {
    dom.classList.remove(LEXICAL_NODE_CLASS.TABLE_CELL_HEADER);
    dom.removeAttribute("scope");
  }
  if (node.isHeader()) {
    dom.removeAttribute(BLOCK_KEYBOARD_ENTRY_ATTRIBUTE);
  } else {
    dom.setAttribute(BLOCK_KEYBOARD_ENTRY_ATTRIBUTE, "primary");
  }
}

export class TableCellNode extends ElementNode {
  __header: boolean;

  static getType(): string {
    return "coflat-table-cell";
  }

  static clone(node: TableCellNode): TableCellNode {
    return new TableCellNode(node.__header, node.__key);
  }

  static importJSON(serializedNode: SerializedTableCellNode): TableCellNode {
    return $createTableCellNode(serializedNode.header).updateFromJSON(serializedNode);
  }

  constructor(header = false, key?: NodeKey) {
    super(key);
    this.__header = header;
  }

  createDOM(): HTMLElement {
    const dom = document.createElement(this.isHeader() ? "th" : "td");
    syncTableCellDom(this, dom);
    return dom;
  }

  updateDOM(prevNode: TableCellNode, dom: HTMLElement): boolean {
    if (prevNode.__header !== this.__header) {
      return true;
    }
    syncTableCellDom(this, dom);
    return false;
  }

  exportJSON(): SerializedTableCellNode {
    return {
      ...super.exportJSON(),
      header: this.isHeader(),
      type: this.getType(),
      version: 1,
    };
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedTableCellNode>,
  ): this {
    return super.updateFromJSON(serializedNode).setHeader(serializedNode.header);
  }

  canBeEmpty(): false {
    return false;
  }

  isHeader(): boolean {
    return this.getLatest().__header;
  }

  setHeader(header: boolean): this {
    const node = this.getWritable();
    node.__header = header;
    return node;
  }
}

export function $createTableCellNode(
  header = false,
  key?: NodeKey,
): TableCellNode {
  return new TableCellNode(header, key);
}

export function $isTableCellNode(
  node: LexicalNode | null | undefined,
): node is TableCellNode {
  return node instanceof TableCellNode;
}
