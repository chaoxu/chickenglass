import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type TextNode,
} from "lexical";

import { OPEN_CURSOR_REVEAL_COMMAND } from "./cursor-reveal-controller";
import {
  createHeadlessCoflatEditor,
  exportMarkdownFromSerializedState,
  setLexicalMarkdown,
} from "./markdown";
import type { MarkdownEditorSelection } from "./markdown-editor-types";
import { $isFootnoteReferenceNode } from "./nodes/footnote-reference-node";
import { $isInlineMathNode } from "./nodes/inline-math-node";
import { $isReferenceNode } from "./nodes/reference-node";
import { sourcePositionFromElement } from "./source-position-dom";

const SOURCE_SELECTION_MARKER = "\uE000coflat-source-selection\uE001";
const SOURCE_NAVIGATION_MARKER = "\uE000coflat-source-navigation\uE001";

interface SourceSelectionReadOptions {
  readonly fallback?: MarkdownEditorSelection;
  readonly markdown?: string;
}

interface SerializedNodeRecord {
  readonly children?: unknown;
  text?: unknown;
  readonly type?: unknown;
  readonly [key: string]: unknown;
}

function isSerializedNodeRecord(value: unknown): value is SerializedNodeRecord {
  return typeof value === "object" && value !== null;
}

function getNodePathFromRoot(node: LexicalNode): number[] | null {
  const path: number[] = [];
  let current: LexicalNode | null = node;

  while (current) {
    const parentNode: LexicalNode | null = current.getParent();
    if (!parentNode) {
      return path;
    }
    if (!$isElementNode(parentNode)) {
      return null;
    }

    const siblings: LexicalNode[] = parentNode.getChildren();
    const index = siblings.findIndex((sibling) => sibling.is(current));
    if (index < 0) {
      return null;
    }
    path.unshift(index);
    current = parentNode;
  }

  return null;
}

function getSerializedNodeAtPath(root: unknown, path: readonly number[]): SerializedNodeRecord | null {
  let current: unknown = root;
  for (const index of path) {
    if (!isSerializedNodeRecord(current) || !Array.isArray(current.children)) {
      return null;
    }
    current = current.children[index];
  }

  return isSerializedNodeRecord(current) ? current : null;
}

function plainParagraphTextCanMapDirectly(node: LexicalNode): boolean {
  if (!$isTextNode(node)) {
    return false;
  }

  const topLevel = node.getTopLevelElement();
  return (
    topLevel?.getType() === "paragraph"
    && node.getFormat() === 0
    && node.getStyle() === ""
  );
}

function findUniquePlainTextOffset(
  markdown: string,
  text: string,
  offset: number,
): number | null {
  if (text.length === 0) {
    return null;
  }

  const first = markdown.indexOf(text);
  if (first < 0) {
    return null;
  }

  if (markdown.indexOf(text, first + text.length) >= 0) {
    return null;
  }

  return first + Math.max(0, Math.min(offset, text.length));
}

function readExactTextOffsetWithMarker(
  editorState: EditorState,
  node: LexicalNode,
  offset: number,
): number | null {
  if (!$isTextNode(node)) {
    return null;
  }

  const path = getNodePathFromRoot(node);
  if (!path) {
    return null;
  }

  const serialized = JSON.parse(JSON.stringify(editorState.toJSON())) as ReturnType<EditorState["toJSON"]>;
  const serializedNode = getSerializedNodeAtPath(serialized.root, path);
  if (!serializedNode || typeof serializedNode.text !== "string") {
    return null;
  }

  const text = serializedNode.text;
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  serializedNode.text = `${text.slice(0, safeOffset)}${SOURCE_SELECTION_MARKER}${text.slice(safeOffset)}`;

  const markedMarkdown = exportMarkdownFromSerializedState(serialized);
  const markerIndex = markedMarkdown.indexOf(SOURCE_SELECTION_MARKER);
  return markerIndex >= 0 ? markerIndex : null;
}

function readSourceOffsetFromRangePoint(
  editor: LexicalEditor,
  editorState: EditorState,
  point: { readonly getNode: () => LexicalNode; readonly offset: number },
  options: SourceSelectionReadOptions,
): number | null {
  const node = point.getNode();
  if ($isTextNode(node)) {
    if (options.markdown && plainParagraphTextCanMapDirectly(node)) {
      const direct = findUniquePlainTextOffset(
        options.markdown,
        node.getTextContent(),
        point.offset,
      );
      if (direct !== null) {
        return direct;
      }
    }

    return readExactTextOffsetWithMarker(editorState, node, point.offset);
  }

  const element = editor.getElementByKey(node.getKey());
  return sourcePositionFromElement(element);
}

function createSourceSelection(
  anchor: number,
  focus: number,
  docLength: number,
): MarkdownEditorSelection {
  const nextAnchor = Math.max(0, Math.min(anchor, docLength));
  const nextFocus = Math.max(0, Math.min(focus, docLength));
  return {
    anchor: nextAnchor,
    focus: nextFocus,
    from: Math.min(nextAnchor, nextFocus),
    to: Math.max(nextAnchor, nextFocus),
  };
}

interface TextMarkerLocation {
  readonly offset: number;
  readonly path: readonly number[];
}

type LiveSourceLocation =
  | {
      readonly kind: "decorator";
      readonly node: LexicalNode;
      readonly offset: number;
    }
  | {
      readonly kind: "text";
      readonly node: TextNode;
      readonly offset: number;
    };

function findTextMarkerLocationInState(
  markdown: string,
  offset: number,
): TextMarkerLocation | null {
  const safeOffset = Math.max(0, Math.min(offset, markdown.length));
  const markedMarkdown = [
    markdown.slice(0, safeOffset),
    SOURCE_NAVIGATION_MARKER,
    markdown.slice(safeOffset),
  ].join("");
  const probeEditor = createHeadlessCoflatEditor();
  setLexicalMarkdown(probeEditor, markedMarkdown);

  return probeEditor.getEditorState().read(() => {
    const visit = (node: LexicalNode, path: readonly number[]): TextMarkerLocation | null => {
      if ($isTextNode(node)) {
        const markerOffset = node.getTextContent().indexOf(SOURCE_NAVIGATION_MARKER);
        return markerOffset >= 0
          ? {
              offset: markerOffset,
              path,
            }
          : null;
      }

      const markerOffset = node.getTextContent().indexOf(SOURCE_NAVIGATION_MARKER);
      if (markerOffset >= 0 && !$isElementNode(node)) {
        return {
          offset: markerOffset,
          path,
        };
      }

      if (!$isElementNode(node)) {
        return null;
      }

      const children = node.getChildren();
      for (let index = 0; index < children.length; index += 1) {
        const found = visit(children[index], [...path, index]);
        if (found) {
          return found;
        }
      }

      return null;
    };

    return visit($getRoot(), []);
  });
}

function getNodeAtPath(path: readonly number[]): LexicalNode | null {
  let current: LexicalNode = $getRoot();
  for (const index of path) {
    if (!$isElementNode(current)) {
      return null;
    }
    const child = current.getChildren()[index];
    if (!child) {
      return null;
    }
    current = child;
  }
  return current;
}

function getInlineDecoratorSource(node: LexicalNode): string | null {
  if ($isInlineMathNode(node) || $isReferenceNode(node) || $isFootnoteReferenceNode(node)) {
    return node.getRaw();
  }
  return null;
}

function findNearestLiveSourceLocation(markdown: string, offset: number): LiveSourceLocation | null {
  const targetOffset = Math.max(0, Math.min(offset, markdown.length));
  let searchFrom = 0;
  let previous: LiveSourceLocation | null = null;
  let nearest: LiveSourceLocation | null = null;

  const visit = (node: LexicalNode): boolean => {
    const source = $isTextNode(node)
      ? node.getTextContent()
      : getInlineDecoratorSource(node);
    if (source !== null) {
      if (source.length === 0) {
        return false;
      }

      const markdownIndex = markdown.indexOf(source, searchFrom);
      if (markdownIndex < 0) {
        return false;
      }

      const sourceEnd = markdownIndex + source.length;
      const kind = $isTextNode(node) ? "text" : "decorator";
      if (targetOffset <= markdownIndex) {
        nearest = { kind, node, offset: 0 } as LiveSourceLocation;
        return true;
      }

      if (targetOffset <= sourceEnd) {
        nearest = { kind, node, offset: targetOffset - markdownIndex } as LiveSourceLocation;
        return true;
      }

      previous = { kind, node, offset: source.length } as LiveSourceLocation;
      searchFrom = sourceEnd;
      return false;
    }

    if (!$isElementNode(node)) {
      return false;
    }

    return node.getChildren().some((child) => visit(child));
  };

  visit($getRoot());
  return nearest ?? previous;
}

function applyCollapsedTextFormat(node: TextNode, collapsed: boolean): void {
  if (!collapsed) {
    return;
  }

  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return;
  }

  selection.format = node.getFormat();
  selection.style = node.getStyle();
}

function openInlineDecoratorRevealFromSourceLocation(
  editor: LexicalEditor,
  node: LexicalNode,
  offset: number,
): boolean {
  const requestBase = (() => {
    if ($isInlineMathNode(node)) {
      return {
        adapterId: "inline-math",
        source: node.getRaw(),
      };
    }
    if ($isReferenceNode(node)) {
      return {
        adapterId: "reference",
        source: node.getRaw(),
      };
    }
    if ($isFootnoteReferenceNode(node)) {
      return {
        adapterId: "footnote-reference",
        source: node.getRaw(),
      };
    }
    return null;
  })();

  if (!requestBase) {
    return false;
  }

  const request = {
    adapterId: requestBase.adapterId,
    caretOffset: Math.max(0, Math.min(offset, requestBase.source.length)),
    entry: "selection",
    nodeKey: node.getKey(),
    source: requestBase.source,
  } as const;
  const handled = editor.dispatchCommand(OPEN_CURSOR_REVEAL_COMMAND, request);
  if (!handled && typeof window !== "undefined") {
    window.setTimeout(() => {
      editor.dispatchCommand(OPEN_CURSOR_REVEAL_COMMAND, request);
    }, 0);
  }
  return true;
}

export function selectSourceOffsetsInRichLexicalRoot(
  editor: LexicalEditor,
  markdown: string,
  anchor: number,
  focus = anchor,
): boolean {
  const anchorLocation = findTextMarkerLocationInState(markdown, anchor);
  const focusLocation = focus === anchor
    ? anchorLocation
    : findTextMarkerLocationInState(markdown, focus);

  let didSelect = false;
  editor.update(() => {
    const collapsed = anchor === focus;
    const directAnchorLocation = findNearestLiveSourceLocation(markdown, anchor);
    const directFocusLocation = collapsed
      ? directAnchorLocation
      : findNearestLiveSourceLocation(markdown, focus);
    if (
      collapsed
      && directAnchorLocation?.kind === "decorator"
      && openInlineDecoratorRevealFromSourceLocation(
        editor,
        directAnchorLocation.node,
        directAnchorLocation.offset,
      )
    ) {
      didSelect = true;
      return;
    }
    if (
      directAnchorLocation?.kind === "text"
      && directFocusLocation?.kind === "text"
    ) {
      const { node: anchorNode, offset: anchorOffset } = directAnchorLocation;
      const { node: focusNode, offset: focusOffset } = directFocusLocation;
      if (anchorNode.is(focusNode)) {
        anchorNode.select(anchorOffset, focusOffset);
        applyCollapsedTextFormat(anchorNode, collapsed);
        didSelect = true;
        return;
      }

      const selection = $createRangeSelection();
      selection.anchor.set(anchorNode.getKey(), anchorOffset, "text");
      selection.focus.set(focusNode.getKey(), focusOffset, "text");
      $setSelection(selection);
      applyCollapsedTextFormat(anchorNode, collapsed);
      didSelect = true;
      return;
    }

    if (!anchorLocation || !focusLocation) {
      return;
    }

    const anchorPathNode = getNodeAtPath(anchorLocation.path);
    const focusPathNode = getNodeAtPath(focusLocation.path);
    if (
      collapsed
      && anchorPathNode
      && openInlineDecoratorRevealFromSourceLocation(editor, anchorPathNode, anchorLocation.offset)
    ) {
      didSelect = true;
      return;
    }
    const anchorLocationWithNode = $isTextNode(anchorPathNode)
      ? { node: anchorPathNode, offset: anchorLocation.offset }
      : null;
    const focusLocationWithNode = $isTextNode(focusPathNode)
      ? { node: focusPathNode, offset: focusLocation.offset }
      : null;
    if (!anchorLocationWithNode || !focusLocationWithNode) {
      return;
    }
    const { node: anchorNode, offset: anchorOffset } = anchorLocationWithNode;
    const { node: focusNode, offset: focusOffset } = focusLocationWithNode;

    if (anchorNode.is(focusNode)) {
      anchorNode.select(anchorOffset, focusOffset);
      applyCollapsedTextFormat(anchorNode, collapsed);
      didSelect = true;
      return;
    }

    const selection = $createRangeSelection();
    selection.anchor.set(anchorNode.getKey(), anchorOffset, "text");
    selection.focus.set(focusNode.getKey(), focusOffset, "text");
    $setSelection(selection);
    applyCollapsedTextFormat(anchorNode, collapsed);
    didSelect = true;
  }, { discrete: true });

  return didSelect;
}

export function readSourceSelectionFromLexicalSelection(
  editor: LexicalEditor,
  options: SourceSelectionReadOptions = {},
): MarkdownEditorSelection | null {
  const editorState = editor.getEditorState();

  return editorState.read(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      const anchor = readSourceOffsetFromRangePoint(editor, editorState, selection.anchor, options);
      const focus = readSourceOffsetFromRangePoint(editor, editorState, selection.focus, options);
      if (anchor !== null && focus !== null) {
        return createSourceSelection(
          anchor,
          focus,
          options.markdown?.length ?? Math.max(anchor, focus),
        );
      }

      const anchorElement = editor.getElementByKey(selection.anchor.getNode().getKey());
      const blockPosition = sourcePositionFromElement(anchorElement);
      if (blockPosition !== null) {
        return createSourceSelection(
          blockPosition,
          blockPosition,
          options.markdown?.length ?? blockPosition,
        );
      }

      return options.fallback ?? null;
    }

    if ($isNodeSelection(selection)) {
      const [node] = selection.getNodes();
      if (!node) {
        return options.fallback ?? null;
      }

      const element = editor.getElementByKey(node.getKey());
      const blockPosition = sourcePositionFromElement(element);
      if (blockPosition !== null) {
        return createSourceSelection(
          blockPosition,
          blockPosition,
          options.markdown?.length ?? blockPosition,
        );
      }
    }

    return options.fallback ?? null;
  });
}
