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

import { ReferenceRenderer } from "../renderers/reference-renderer";

export type SerializedReferenceNode = Spread<{
  raw: string;
}, SerializedLexicalNode>;

export class ReferenceNode extends DecoratorNode<JSX.Element> {
  __raw: string;

  static getType(): string {
    return "coflat-reference";
  }

  static clone(node: ReferenceNode): ReferenceNode {
    return new ReferenceNode(node.__raw, node.__key);
  }

  static importJSON(serializedNode: SerializedReferenceNode): ReferenceNode {
    return $createReferenceNode(serializedNode.raw).updateFromJSON(serializedNode);
  }

  constructor(raw: string, key?: NodeKey) {
    super(key);
    this.__raw = raw;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    return document.createElement("span");
  }

  isInline(): boolean {
    return true;
  }

  updateDOM(): false {
    return false;
  }

  exportJSON(): SerializedReferenceNode {
    return {
      raw: this.getRaw(),
      type: this.getType(),
      version: 1,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedReferenceNode>): this {
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
    return createElement(ReferenceRenderer, {
      nodeKey: this.getKey(),
      raw: this.getRaw(),
    });
  }
}

export function $createReferenceNode(raw: string): ReferenceNode {
  return new ReferenceNode(raw);
}

export function $isReferenceNode(node: LexicalNode | null | undefined): node is ReferenceNode {
  return node instanceof ReferenceNode;
}
