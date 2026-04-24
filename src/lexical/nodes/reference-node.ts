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

import { getReferenceRenderer } from "./renderer-registry";

export type SerializedReferenceNode = Spread<{
  format: number;
  raw: string;
}, SerializedLexicalNode>;

export class ReferenceNode extends DecoratorNode<JSX.Element> {
  __raw: string;
  __format: number;

  static getType(): string {
    return "coflat-reference";
  }

  static clone(node: ReferenceNode): ReferenceNode {
    return new ReferenceNode(node.__raw, node.__format, node.__key);
  }

  static importJSON(serializedNode: SerializedReferenceNode): ReferenceNode {
    return $createReferenceNode(serializedNode.raw).updateFromJSON(serializedNode);
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

  exportJSON(): SerializedReferenceNode {
    return {
      format: this.getFormat(),
      raw: this.getRaw(),
      type: this.getType(),
      version: 1,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedReferenceNode>): this {
    return super.updateFromJSON(serializedNode)
      .setFormat(serializedNode.format ?? 0)
      .setRaw(serializedNode.raw);
  }

  getTextContent(): string {
    return this.getRaw();
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

  decorate(): JSX.Element {
    const Renderer = getReferenceRenderer();
    return createElement(Renderer, {
      nodeKey: this.getKey(),
      raw: this.getRaw(),
    });
  }
}

export function $createReferenceNode(raw: string, format = 0): ReferenceNode {
  return new ReferenceNode(raw, format);
}

export function $isReferenceNode(node: LexicalNode | null | undefined): node is ReferenceNode {
  return node instanceof ReferenceNode;
}
