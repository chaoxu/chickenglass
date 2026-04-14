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

import { getFootnoteReferenceRenderer } from "./renderer-registry";

export type SerializedFootnoteReferenceNode = Spread<{
  raw: string;
}, SerializedLexicalNode>;

export class FootnoteReferenceNode extends DecoratorNode<JSX.Element> {
  __raw: string;

  static getType(): string {
    return "coflat-footnote-reference";
  }

  static clone(node: FootnoteReferenceNode): FootnoteReferenceNode {
    return new FootnoteReferenceNode(node.__raw, node.__key);
  }

  static importJSON(serializedNode: SerializedFootnoteReferenceNode): FootnoteReferenceNode {
    return $createFootnoteReferenceNode(serializedNode.raw).updateFromJSON(serializedNode);
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

  exportJSON(): SerializedFootnoteReferenceNode {
    return {
      raw: this.getRaw(),
      type: this.getType(),
      version: 1,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedFootnoteReferenceNode>): this {
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
    const Renderer = getFootnoteReferenceRenderer();
    return createElement(Renderer, {
      raw: this.getRaw(),
    });
  }
}

export function $createFootnoteReferenceNode(raw: string): FootnoteReferenceNode {
  return new FootnoteReferenceNode(raw);
}

export function $isFootnoteReferenceNode(
  node: LexicalNode | null | undefined,
): node is FootnoteReferenceNode {
  return node instanceof FootnoteReferenceNode;
}
