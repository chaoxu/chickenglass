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

export type InlineMathDelimiter = "dollar" | "paren";

export type SerializedInlineMathNode = Spread<{
  delimiter: InlineMathDelimiter;
  raw: string;
}, SerializedLexicalNode>;

import { InlineMathRenderer } from "../renderers/inline-math-renderer";

export class InlineMathNode extends DecoratorNode<JSX.Element> {
  __raw: string;
  __delimiter: InlineMathDelimiter;

  static getType(): string {
    return "coflat-inline-math";
  }

  static clone(node: InlineMathNode): InlineMathNode {
    return new InlineMathNode(node.__raw, node.__delimiter, node.__key);
  }

  static importJSON(serializedNode: SerializedInlineMathNode): InlineMathNode {
    return $createInlineMathNode(serializedNode.raw, serializedNode.delimiter).updateFromJSON(
      serializedNode,
    );
  }

  constructor(raw: string, delimiter: InlineMathDelimiter, key?: NodeKey) {
    super(key);
    this.__raw = raw;
    this.__delimiter = delimiter;
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

  exportJSON(): SerializedInlineMathNode {
    return {
      delimiter: this.getDelimiter(),
      raw: this.getRaw(),
      type: "coflat-inline-math",
      version: 1,
    };
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedInlineMathNode>,
  ): this {
    return super.updateFromJSON(serializedNode)
      .setDelimiter(serializedNode.delimiter)
      .setRaw(serializedNode.raw);
  }

  getDelimiter(): InlineMathDelimiter {
    return this.getLatest().__delimiter;
  }

  setDelimiter(delimiter: InlineMathDelimiter): this {
    const node = this.getWritable();
    node.__delimiter = delimiter;
    return node;
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
    return createElement(InlineMathRenderer, {
      nodeKey: this.getKey(),
      raw: this.getRaw(),
    });
  }
}

export function $createInlineMathNode(raw: string, delimiter: InlineMathDelimiter): InlineMathNode {
  return new InlineMathNode(raw, delimiter);
}

export function $isInlineMathNode(node: LexicalNode | null | undefined): node is InlineMathNode {
  return node instanceof InlineMathNode;
}
