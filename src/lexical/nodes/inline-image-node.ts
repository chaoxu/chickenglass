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

import { InlineImageRenderer } from "../node-renderers";

export type SerializedInlineImageNode = Spread<{
  raw: string;
}, SerializedLexicalNode>;

export class InlineImageNode extends DecoratorNode<JSX.Element> {
  __raw: string;

  static getType(): string {
    return "coflat-inline-image";
  }

  static clone(node: InlineImageNode): InlineImageNode {
    return new InlineImageNode(node.__raw, node.__key);
  }

  static importJSON(serializedNode: SerializedInlineImageNode): InlineImageNode {
    return $createInlineImageNode(serializedNode.raw).updateFromJSON(serializedNode);
  }

  constructor(raw: string, key?: NodeKey) {
    super(key);
    this.__raw = raw;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    return document.createElement("span");
  }

  updateDOM(): false {
    return false;
  }

  exportJSON(): SerializedInlineImageNode {
    return {
      raw: this.getRaw(),
      type: "coflat-inline-image",
      version: 1,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedInlineImageNode>): this {
    return super.updateFromJSON(serializedNode).setRaw(serializedNode.raw);
  }

  getRaw(): string {
    return this.getLatest().__raw;
  }

  setRaw(raw: string): this {
    const node = this.getWritable();
    node.__raw = raw;
    return node;
  }

  getTextContent(): string {
    return this.getRaw();
  }

  decorate(): JSX.Element {
    return createElement(InlineImageRenderer, {
      nodeKey: this.getKey(),
      raw: this.getRaw(),
    });
  }
}

export function $createInlineImageNode(raw: string): InlineImageNode {
  return new InlineImageNode(raw);
}

export function $isInlineImageNode(node: LexicalNode | null | undefined): node is InlineImageNode {
  return node instanceof InlineImageNode;
}
