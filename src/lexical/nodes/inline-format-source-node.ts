import {
  TextNode,
  type EditorConfig,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from "lexical";

import { getInlineTextFormatThemeClassNames } from "../../lexical-next";
import type { EntrySide } from "../inline-format-source";

export const EMPTY_INLINE_FORMAT_SOURCE_SENTINEL = "\u200b";

export type SerializedInlineFormatSourceNode = Spread<{
  displayClasses: string[];
  entrySide: EntrySide;
  initialRaw: string;
}, SerializedTextNode>;

interface InlineFormatSourceNodeOptions {
  readonly displayClasses?: readonly string[];
  readonly entrySide?: EntrySide;
  readonly initialRaw?: string;
}

function syncInlineFormatSourceDom(
  node: InlineFormatSourceNode,
  dom: HTMLElement,
): void {
  dom.classList.add("cf-lexical-inline-format-source");
  dom.classList.remove(...getInlineTextFormatThemeClassNames());
  for (const className of node.getDisplayClasses()) {
    dom.classList.add(className);
  }
  dom.dataset.coflatInlineFormatSource = "true";
  dom.dataset.coflatInlineFormatSourceKey = node.getKey();
}

export class InlineFormatSourceNode extends TextNode {
  __displayClasses: string[];
  __entrySide: EntrySide;
  __initialRaw: string;

  static getType(): string {
    return "coflat-inline-format-source";
  }

  static clone(node: InlineFormatSourceNode): InlineFormatSourceNode {
    return new InlineFormatSourceNode(node.__text, {
      displayClasses: node.__displayClasses,
      entrySide: node.__entrySide,
      initialRaw: node.__initialRaw,
    }, node.__key);
  }

  static importJSON(serializedNode: SerializedInlineFormatSourceNode): InlineFormatSourceNode {
    return $createInlineFormatSourceNode(serializedNode.text, {
      displayClasses: serializedNode.displayClasses,
      entrySide: serializedNode.entrySide,
      initialRaw: serializedNode.initialRaw,
    }).updateFromJSON(serializedNode);
  }

  constructor(text: string, options: InlineFormatSourceNodeOptions = {}, key?: NodeKey) {
    super(text, key);
    this.__displayClasses = [...(options.displayClasses ?? [])];
    this.__entrySide = options.entrySide ?? "end";
    this.__initialRaw = options.initialRaw ?? text;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    syncInlineFormatSourceDom(this, dom);
    return dom;
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const needsUpdate = super.updateDOM(prevNode, dom, config);
    syncInlineFormatSourceDom(this, dom);
    return needsUpdate;
  }

  exportJSON(): SerializedInlineFormatSourceNode {
    return {
      ...super.exportJSON(),
      displayClasses: this.getDisplayClasses(),
      entrySide: this.getEntrySide(),
      initialRaw: this.getInitialRaw(),
      type: "coflat-inline-format-source",
      version: 1,
    };
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedInlineFormatSourceNode>,
  ): this {
    return super
      .updateFromJSON(serializedNode)
      .setDisplayClasses(serializedNode.displayClasses)
      .setInitialRaw(serializedNode.initialRaw)
      .setEntrySide(serializedNode.entrySide);
  }

  getDisplayClasses(): string[] {
    return [...this.getLatest().__displayClasses];
  }

  setDisplayClasses(displayClasses: readonly string[]): this {
    const node = this.getWritable();
    node.__displayClasses = [...displayClasses];
    return node;
  }

  getEntrySide(): EntrySide {
    return this.getLatest().__entrySide;
  }

  setEntrySide(entrySide: EntrySide): this {
    const node = this.getWritable();
    node.__entrySide = entrySide;
    return node;
  }

  getInitialRaw(): string {
    return this.getLatest().__initialRaw;
  }

  setInitialRaw(initialRaw: string): this {
    const node = this.getWritable();
    node.__initialRaw = initialRaw;
    return node;
  }

  getRaw(): string {
    const raw = this.getTextContent();
    return raw === EMPTY_INLINE_FORMAT_SOURCE_SENTINEL ? "" : raw;
  }

  isTextEntity(): false {
    return false;
  }
}

export function $createInlineFormatSourceNode(
  raw: string,
  options: InlineFormatSourceNodeOptions = {},
): InlineFormatSourceNode {
  return new InlineFormatSourceNode(raw, options).toggleUnmergeable();
}

export function $isInlineFormatSourceNode(
  node: LexicalNode | null | undefined,
): node is InlineFormatSourceNode {
  return node instanceof InlineFormatSourceNode;
}
