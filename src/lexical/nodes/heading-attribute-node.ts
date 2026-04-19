import { createElement, type JSX } from "react";
import {
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";

export type SerializedHeadingAttributeNode = Spread<{
  raw: string;
}, SerializedLexicalNode>;

export class HeadingAttributeNode extends DecoratorNode<JSX.Element> {
  __raw: string;

  static getType(): string {
    return "coflat-heading-attribute";
  }

  static clone(node: HeadingAttributeNode): HeadingAttributeNode {
    return new HeadingAttributeNode(node.__raw, node.__key);
  }

  static importJSON(serializedNode: SerializedHeadingAttributeNode): HeadingAttributeNode {
    return $createHeadingAttributeNode(serializedNode.raw).updateFromJSON(serializedNode);
  }

  constructor(raw: string, key?: NodeKey) {
    super(key);
    this.__raw = raw;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("span");
    element.className = "cf-heading-attribute-token";
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  isInline(): boolean {
    return true;
  }

  canInsertTextAfter(): false {
    return false;
  }

  canInsertTextBefore(): false {
    return false;
  }

  updateDOM(): false {
    return false;
  }

  exportJSON(): SerializedHeadingAttributeNode {
    return {
      raw: this.getRaw(),
      type: this.getType(),
      version: 1,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedHeadingAttributeNode>): this {
    return super.updateFromJSON(serializedNode).setRaw(serializedNode.raw);
  }

  getTextContent(): string {
    return this.getRaw();
  }

  getRaw(): string {
    return this.getLatest().__raw;
  }

  setRaw(raw: string): this {
    const node = this.getWritable();
    node.__raw = raw;
    return node;
  }

  decorate(): JSX.Element {
    return createElement("span", {
      "aria-hidden": true,
      className: "cf-heading-attribute-token__content",
    });
  }
}

export function $createHeadingAttributeNode(raw: string): HeadingAttributeNode {
  return new HeadingAttributeNode(raw);
}

export function $isHeadingAttributeNode(
  node: LexicalNode | null | undefined,
): node is HeadingAttributeNode {
  return node instanceof HeadingAttributeNode;
}
