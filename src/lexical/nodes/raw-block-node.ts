import { createElement, type JSX } from "react";
import {
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode,
} from "@lexical/react/LexicalDecoratorBlockNode";
import {
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type Spread,
} from "lexical";

import { getRawBlockRenderer } from "./raw-block-renderer-registry";

export type RawBlockVariant =
  | "display-math"
  | "fenced-div"
  | "footnote-definition"
  | "frontmatter"
  | "image";

export type SerializedRawBlockNode = Spread<{
  raw: string;
  variant: RawBlockVariant;
}, SerializedDecoratorBlockNode>;

export class RawBlockNode extends DecoratorBlockNode {
  __raw: string;
  __variant: RawBlockVariant;

  static getType(): string {
    return "coflat-raw-block";
  }

  static clone(node: RawBlockNode): RawBlockNode {
    return new RawBlockNode(node.__variant, node.__raw, node.__key);
  }

  static importJSON(serializedNode: SerializedRawBlockNode): RawBlockNode {
    return $createRawBlockNode(serializedNode.variant, serializedNode.raw).updateFromJSON(
      serializedNode,
    );
  }

  constructor(variant: RawBlockVariant, raw: string, key?: NodeKey) {
    super(undefined, key);
    this.__raw = raw;
    this.__variant = variant;
  }

  exportJSON(): SerializedRawBlockNode {
    return {
      ...super.exportJSON(),
      raw: this.getRaw(),
      type: this.getType(),
      variant: this.getVariant(),
      version: 1,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedRawBlockNode>): this {
    return super.updateFromJSON(serializedNode)
      .setVariant(serializedNode.variant)
      .setRaw(serializedNode.raw);
  }

  getTextContent(): string {
    return this.getLatest().__raw;
  }

  getRaw(): string {
    return this.getLatest().__raw;
  }

  setRaw(raw: string): this {
    const node = this.getWritable();
    node.__raw = raw;
    return node;
  }

  getVariant(): RawBlockVariant {
    return this.getLatest().__variant;
  }

  setVariant(variant: RawBlockVariant): this {
    const node = this.getWritable();
    node.__variant = variant;
    return node;
  }

  decorate(): JSX.Element {
    const Renderer = getRawBlockRenderer();
    return createElement(Renderer, {
      nodeKey: this.getKey(),
      raw: this.getRaw(),
      variant: this.getVariant(),
    });
  }
}

export function $createRawBlockNode(variant: RawBlockVariant, raw: string): RawBlockNode {
  return new RawBlockNode(variant, raw);
}

export function $isRawBlockNode(node: LexicalNode | null | undefined): node is RawBlockNode {
  return node instanceof RawBlockNode;
}
