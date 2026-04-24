import {
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { createElement, type JSX } from "react";

export type InlineMathDelimiter = "dollar" | "paren";

export type SerializedInlineMathNode = Spread<{
  delimiter: InlineMathDelimiter;
  format: number;
  raw: string;
}, SerializedLexicalNode>;

import { getInlineMathRenderer } from "./renderer-registry";

export class InlineMathNode extends DecoratorNode<JSX.Element> {
  __raw: string;
  __delimiter: InlineMathDelimiter;
  __format: number;

  static getType(): string {
    return "coflat-inline-math";
  }

  static clone(node: InlineMathNode): InlineMathNode {
    return new InlineMathNode(node.__raw, node.__delimiter, node.__format, node.__key);
  }

  static importJSON(serializedNode: SerializedInlineMathNode): InlineMathNode {
    return $createInlineMathNode(serializedNode.raw, serializedNode.delimiter).updateFromJSON(
      serializedNode,
    );
  }

  constructor(raw: string, delimiter: InlineMathDelimiter, format = 0, key?: NodeKey) {
    super(key);
    this.__raw = raw;
    this.__delimiter = delimiter;
    this.__format = format;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    return document.createElement("span");
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

  exportJSON(): SerializedInlineMathNode {
    return {
      delimiter: this.getDelimiter(),
      format: this.getFormat(),
      raw: this.getRaw(),
      type: this.getType(),
      version: 1,
    };
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedInlineMathNode>,
  ): this {
    return super.updateFromJSON(serializedNode)
      .setDelimiter(serializedNode.delimiter)
      .setFormat(serializedNode.format ?? 0)
      .setRaw(serializedNode.raw);
  }

  getFormat(): number {
    return this.getLatest().__format;
  }

  setFormat(format: number): this {
    const node = this.getWritable();
    node.__format = format;
    return node;
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
    const Renderer = getInlineMathRenderer();
    return createElement(Renderer, {
      nodeKey: this.getKey(),
      raw: this.getRaw(),
    });
  }
}

export function $createInlineMathNode(
  raw: string,
  delimiter: InlineMathDelimiter,
  format = 0,
): InlineMathNode {
  return new InlineMathNode(raw, delimiter, format);
}

export function $isInlineMathNode(node: LexicalNode | null | undefined): node is InlineMathNode {
  return node instanceof InlineMathNode;
}
