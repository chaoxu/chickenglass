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

import { InlineImageRenderer } from "../renderers/inline-image-renderer";

export type SerializedInlineImageNode = Spread<{
  format: number;
  raw: string;
}, SerializedLexicalNode>;

export class InlineImageNode extends DecoratorNode<JSX.Element> {
  __raw: string;
  __format: number;

  static getType(): string {
    return "coflat-inline-image";
  }

  static clone(node: InlineImageNode): InlineImageNode {
    return new InlineImageNode(node.__raw, node.__format, node.__key);
  }

  static importJSON(serializedNode: SerializedInlineImageNode): InlineImageNode {
    return $createInlineImageNode(serializedNode.raw).updateFromJSON(serializedNode);
  }

  constructor(raw: string, format = 0, key?: NodeKey) {
    super(key);
    this.__raw = raw;
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

  exportJSON(): SerializedInlineImageNode {
    return {
      format: this.getFormat(),
      raw: this.getRaw(),
      type: this.getType(),
      version: 1,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedInlineImageNode>): this {
    return super.updateFromJSON(serializedNode)
      .setFormat(serializedNode.format ?? 0)
      .setRaw(serializedNode.raw);
  }

  getRaw(): string {
    return this.getLatest().__raw;
  }

  getFormat(): number {
    return this.getLatest().__format;
  }

  setFormat(format: number): this {
    const node = this.getWritable();
    node.__format = format;
    return node;
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

export function $createInlineImageNode(raw: string, format = 0): InlineImageNode {
  return new InlineImageNode(raw, format);
}

export function $isInlineImageNode(node: LexicalNode | null | undefined): node is InlineImageNode {
  return node instanceof InlineImageNode;
}
