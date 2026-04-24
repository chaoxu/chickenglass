import {
  type ElementDOMSlot,
  ElementNode,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
} from "lexical";
import { LEXICAL_NODE_CLASS } from "../../constants/lexical-css-classes";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../../document-surface-classes";
import {
  markTableSourceBlock,
  SOURCE_POSITION_DATASET,
} from "../source-position-contract";

export type TableColumnAlignment = "center" | "left" | "right" | null;

export type SerializedTableNode = Spread<{
  alignments: TableColumnAlignment[];
  dividerCells?: string[];
}, SerializedElementNode>;

function syncTableDom(node: TableNode, dom: HTMLTableElement): void {
  dom.className = documentSurfaceClassNames(
    DOCUMENT_SURFACE_CLASS.tableBlock,
    LEXICAL_NODE_CLASS.TABLE_BLOCK,
  );
  markTableSourceBlock(dom, node.getAlignments().length);
  dom.dataset[SOURCE_POSITION_DATASET.sourceBlockNodeKey] = node.getKey();
}

export class TableNode extends ElementNode {
  __alignments: TableColumnAlignment[];
  __dividerCells: string[];

  static getType(): string {
    return "coflat-table";
  }

  static clone(node: TableNode): TableNode {
    return new TableNode(node.__alignments, node.__dividerCells, node.__key);
  }

  static importJSON(serializedNode: SerializedTableNode): TableNode {
    return $createTableNode(
      serializedNode.alignments,
      serializedNode.dividerCells,
    ).updateFromJSON(serializedNode);
  }

  constructor(
    alignments: readonly TableColumnAlignment[] = [],
    dividerCells: readonly string[] = [],
    key?: NodeKey,
  ) {
    super(key);
    this.__alignments = [...alignments];
    this.__dividerCells = [...dividerCells];
  }

  createDOM(): HTMLTableElement {
    const dom = document.createElement("table");
    dom.append(document.createElement("tbody"));
    syncTableDom(this, dom);
    return dom;
  }

  getDOMSlot(dom: HTMLTableElement): ElementDOMSlot<HTMLElement> {
    const tbody = dom.tBodies[0] ?? dom.appendChild(document.createElement("tbody"));
    return super.getDOMSlot(tbody);
  }

  updateDOM(prevNode: TableNode, dom: HTMLTableElement): false {
    if (
      prevNode.__alignments !== this.__alignments
      || prevNode.__dividerCells !== this.__dividerCells
    ) {
      syncTableDom(this, dom);
    }
    return false;
  }

  exportJSON(): SerializedTableNode {
    return {
      ...super.exportJSON(),
      alignments: [...this.getAlignments()],
      dividerCells: [...this.getDividerCells()],
      type: this.getType(),
      version: 1,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedTableNode>): this {
    return super
      .updateFromJSON(serializedNode)
      .setAlignments(serializedNode.alignments)
      .setDividerCells(serializedNode.dividerCells ?? []);
  }

  canBeEmpty(): false {
    return false;
  }

  getAlignments(): TableColumnAlignment[] {
    return [...this.getLatest().__alignments];
  }

  setAlignments(alignments: readonly TableColumnAlignment[]): this {
    const node = this.getWritable();
    node.__alignments = [...alignments];
    return node;
  }

  getDividerCells(): string[] {
    return [...this.getLatest().__dividerCells];
  }

  setDividerCells(dividerCells: readonly string[]): this {
    const node = this.getWritable();
    node.__dividerCells = [...dividerCells];
    return node;
  }
}

export function $createTableNode(
  alignments: readonly TableColumnAlignment[] = [],
  dividerCells: readonly string[] = [],
): TableNode {
  return new TableNode(alignments, dividerCells);
}

export function $isTableNode(
  node: LexicalNode | null | undefined,
): node is TableNode {
  return node instanceof TableNode;
}
