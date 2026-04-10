import { useCallback, useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getAdjacentNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $parseSerializedNode,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  mergeRegister,
  type NodeKey,
} from "lexical";

import {
  collectInlineFormatSegment,
  isEditableInlineFormatNode,
  parseInlineFormatSource,
  selectOutsideSiblingRange,
  serializeInlineFormatSegment,
  type EntrySide,
  type ExitDirection,
} from "./inline-format-source";
import {
  $createInlineFormatSourceNode,
  EMPTY_INLINE_FORMAT_SOURCE_SENTINEL,
  $isInlineFormatSourceNode,
} from "./nodes/inline-format-source-node";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";

const INLINE_FORMAT_SELECTOR = ".cf-bold, .cf-italic, .cf-strikethrough, .cf-highlight, .cf-inline-code";

function getInlineFormatDisplayClasses(node: {
  hasFormat: (format: "bold" | "italic" | "strikethrough" | "highlight" | "code") => boolean;
}): string[] {
  const classNames: string[] = [];
  if (node.hasFormat("bold")) {
    classNames.push("cf-bold");
  }
  if (node.hasFormat("italic")) {
    classNames.push("cf-italic");
  }
  if (node.hasFormat("strikethrough")) {
    classNames.push("cf-strikethrough");
  }
  if (node.hasFormat("highlight")) {
    classNames.push("cf-highlight");
  }
  if (node.hasFormat("code")) {
    classNames.push("cf-inline-code");
  }
  return classNames;
}

function normalizeInlineFormatSourceRaw(raw: string): string {
  return raw === EMPTY_INLINE_FORMAT_SOURCE_SENTINEL ? "" : raw;
}

function toStoredInlineFormatSourceRaw(raw: string): string {
  return raw === "" ? EMPTY_INLINE_FORMAT_SOURCE_SENTINEL : raw;
}

function getInlineFormatDelimiterLengths(raw: string): {
  readonly close: number;
  readonly open: number;
} {
  const delimiters = ["***", "**", "~~", "==", "*", "`"];
  for (const delimiter of delimiters) {
    if (raw.startsWith(delimiter) && raw.endsWith(delimiter) && raw.length >= delimiter.length * 2) {
      return {
        close: delimiter.length,
        open: delimiter.length,
      };
    }
  }
  return {
    close: 0,
    open: 0,
  };
}

function getInlineFormatEntryCaretOffset(raw: string, entrySide: EntrySide): number {
  const delimiters = getInlineFormatDelimiterLengths(raw);
  if (entrySide === "start") {
    return delimiters.open;
  }
  return Math.max(0, raw.length - delimiters.close);
}

function isInlineFormatRawBoundary(
  raw: string,
  offset: number,
  direction: ExitDirection,
): boolean {
  if (direction === "before") {
    return offset <= 0;
  }
  return offset >= raw.length;
}

interface InlineFormatActivation {
  readonly entrySide: EntrySide;
  readonly nodeKey: NodeKey;
}

interface SourceSelectionOffsets {
  readonly end: number;
  readonly nodeKey: NodeKey;
  readonly start: number;
}

function resolveInlineFormatAnchor(target: EventTarget | null): HTMLElement | null {
  const element = target instanceof HTMLElement
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  const anchor = element?.closest<HTMLElement>(INLINE_FORMAT_SELECTOR) ?? null;
  if (!anchor) {
    return null;
  }
  return anchor.closest("a.cf-lexical-link") ? null : anchor;
}

function findBoundarySibling(rootElement: HTMLElement, startNode: Node, isBackward: boolean): Node | null {
  let current: Node | null = startNode;
  while (current && current !== rootElement) {
    const sibling = isBackward ? current.previousSibling : current.nextSibling;
    if (sibling) {
      return sibling;
    }
    current = current.parentNode;
  }
  return null;
}

function findInlineFormatAnchorInNode(node: Node | null, isBackward: boolean): HTMLElement | null {
  if (!node) {
    return null;
  }

  if (node instanceof HTMLElement) {
    if (node.matches(INLINE_FORMAT_SELECTOR) && !node.closest("a.cf-lexical-link")) {
      return node;
    }
    const matches = node.querySelectorAll<HTMLElement>(INLINE_FORMAT_SELECTOR);
    if (matches.length > 0) {
      return isBackward ? matches[matches.length - 1] : matches[0];
    }
  }

  const child = isBackward ? node.lastChild : node.firstChild;
  return findInlineFormatAnchorInNode(child, isBackward);
}

function findInlineFormatAnchorFromDomSelection(
  rootElement: HTMLElement | null,
  isBackward: boolean,
): HTMLElement | null {
  if (!rootElement) {
    return null;
  }

  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed) {
    return null;
  }

  const anchorNode = selection.anchorNode;
  if (!anchorNode || !rootElement.contains(anchorNode)) {
    return null;
  }

  if (anchorNode instanceof Text) {
    const textLength = anchorNode.textContent?.length ?? 0;
    if ((isBackward && selection.anchorOffset !== 0) || (!isBackward && selection.anchorOffset !== textLength)) {
      return null;
    }
    const sibling = findBoundarySibling(rootElement, anchorNode, isBackward);
    return findInlineFormatAnchorInNode(sibling, isBackward);
  }

  if (anchorNode instanceof Element) {
    const childIndex = isBackward ? selection.anchorOffset - 1 : selection.anchorOffset;
    if (childIndex >= 0 && childIndex < anchorNode.childNodes.length) {
      return findInlineFormatAnchorInNode(anchorNode.childNodes[childIndex], isBackward);
    }
    const sibling = findBoundarySibling(rootElement, anchorNode, isBackward);
    return findInlineFormatAnchorInNode(sibling, isBackward);
  }

  return null;
}

function measureTextOffsetWithinElement(
  element: HTMLElement,
  node: Node,
  offset: number,
): number {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(node, offset);
  return range.toString().length;
}

function readSourceSelectionOffsets(rootElement: HTMLElement | null): SourceSelectionOffsets | null {
  if (!rootElement) {
    return null;
  }

  const selection = window.getSelection();
  if (!selection || !selection.anchorNode || !selection.focusNode) {
    return null;
  }

  const sourceElement = (
    selection.anchorNode instanceof Element
      ? selection.anchorNode
      : selection.anchorNode.parentElement
  )?.closest<HTMLElement>(".cf-lexical-inline-format-source");
  if (
    !(sourceElement instanceof HTMLElement)
    || !rootElement.contains(sourceElement)
    || !sourceElement.contains(selection.anchorNode)
    || !sourceElement.contains(selection.focusNode)
  ) {
    return null;
  }

  const nodeKey = sourceElement.dataset.coflatInlineFormatSourceKey;
  if (!nodeKey) {
    return null;
  }

  if (sourceElement.textContent === EMPTY_INLINE_FORMAT_SOURCE_SENTINEL) {
    return {
      end: 0,
      nodeKey,
      start: 0,
    };
  }

  const anchorOffset = measureTextOffsetWithinElement(
    sourceElement,
    selection.anchorNode,
    selection.anchorOffset,
  );
  const focusOffset = measureTextOffsetWithinElement(
    sourceElement,
    selection.focusNode,
    selection.focusOffset,
  );

  return {
    end: Math.max(anchorOffset, focusOffset),
    nodeKey,
    start: Math.min(anchorOffset, focusOffset),
  };
}

function readInlineFormatState(): {
  readonly activeSourceNodeKeys: readonly NodeKey[];
  readonly nextActivation: InlineFormatActivation | null;
  readonly selectedSourceNodeKey: NodeKey | null;
} {
  const root = $getRoot();
  const activeSourceNodeKeys = root
    .getAllTextNodes()
    .filter($isInlineFormatSourceNode)
    .map((node) => node.getKey());

  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return {
      activeSourceNodeKeys,
      nextActivation: null,
      selectedSourceNodeKey: null,
    };
  }

  const anchorNode = selection.anchor.getNode();
  if ($isInlineFormatSourceNode(anchorNode)) {
    return {
      activeSourceNodeKeys,
      nextActivation: null,
      selectedSourceNodeKey: anchorNode.getKey(),
    };
  }

  if (!isEditableInlineFormatNode(anchorNode)) {
    return {
      activeSourceNodeKeys,
      nextActivation: null,
      selectedSourceNodeKey: null,
    };
  }

  const textLength = anchorNode.getTextContentSize();
  return {
    activeSourceNodeKeys,
    nextActivation: {
      entrySide: selection.anchor.offset <= textLength / 2 ? "start" : "end",
      nodeKey: anchorNode.getKey(),
    },
    selectedSourceNodeKey: null,
  };
}

function restoreInlineFormatSourceNode(
  nodeKey: NodeKey,
  options: {
    readonly move?: ExitDirection;
    readonly restore?: boolean;
  } = {},
): boolean {
  const node = $getNodeByKey(nodeKey);
  if (!$isInlineFormatSourceNode(node)) {
    return false;
  }

  const replacementRaw = options.restore ? node.getInitialRaw() : node.getTextContent();
  const nextNodes = parseInlineFormatSource(normalizeInlineFormatSourceRaw(replacementRaw)).map((serializedNode) =>
    $parseSerializedNode(serializedNode)
  );
  const firstInserted = nextNodes[0];
  if (!firstInserted) {
    return false;
  }

  let tail = firstInserted;
  node.replace(firstInserted);
  for (let index = 1; index < nextNodes.length; index += 1) {
    tail.insertAfter(nextNodes[index], false);
    tail = nextNodes[index];
  }

  if (options.move) {
    selectOutsideSiblingRange(firstInserted, tail, options.move);
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      selection.setFormat(0);
    }
  }

  return true;
}

export function InlineFormatSourcePlugin() {
  const [editor] = useLexicalComposerContext();

  const closeEditing = useCallback((
    nodeKey: NodeKey,
    options: {
      readonly move?: ExitDirection;
      readonly restore?: boolean;
    } = {},
  ) => {
    let closed = false;

    editor.update(() => {
      closed = restoreInlineFormatSourceNode(nodeKey, options);
    }, {
      discrete: true,
      tag: COFLAT_NESTED_EDIT_TAG,
    });

    if (closed && options.move) {
      editor.focus();
    }

    return closed;
  }, [editor]);

  const closeActiveSources = useCallback((
    nodeKeys: readonly NodeKey[],
  ) => {
    for (const nodeKey of nodeKeys) {
      closeEditing(nodeKey);
    }
  }, [closeEditing]);

  const startEditing = useCallback((
    nodeKey: NodeKey,
    entrySide: EntrySide,
  ) => {
    let started = false;

    editor.update(() => {
      const root = $getRoot();
      const existingSourceNodes = root.getAllTextNodes().filter($isInlineFormatSourceNode);
      for (const existingSourceNode of existingSourceNodes) {
        if (existingSourceNode.getKey() !== nodeKey) {
          restoreInlineFormatSourceNode(existingSourceNode.getKey());
        }
      }

      const node = $getNodeByKey(nodeKey);
      if (!isEditableInlineFormatNode(node)) {
        return;
      }

      const segment = collectInlineFormatSegment(node);
      if (!segment) {
        return;
      }

      const segmentNodes = segment.nodeKeys
        .map((currentNodeKey) => $getNodeByKey(currentNodeKey))
        .filter(isEditableInlineFormatNode);
      const firstNode = segmentNodes[0];
      if (!firstNode) {
        return;
      }

      const raw = serializeInlineFormatSegment(segment.serializedNodes);
      const sourceNode = $createInlineFormatSourceNode(raw, {
        displayClasses: getInlineFormatDisplayClasses(firstNode),
        entrySide,
        initialRaw: raw,
      });
      sourceNode.setStyle(firstNode.getStyle());

      firstNode.replace(sourceNode);
      for (let index = 1; index < segmentNodes.length; index += 1) {
        segmentNodes[index].remove();
      }

      const caretOffset = getInlineFormatEntryCaretOffset(raw, entrySide);
      sourceNode.select(caretOffset, caretOffset);
      started = true;
    }, {
      discrete: true,
      tag: COFLAT_NESTED_EDIT_TAG,
    });

    return started;
  }, [editor]);

  useEffect(() => {
    let queuedNodeKey: NodeKey | null = null;
    let pendingActivation: InlineFormatActivation | null = null;

    const getActivationFromAnchor = (
      anchor: HTMLElement,
      entrySide: EntrySide,
    ): InlineFormatActivation | null => {
      let nextNodeKey: NodeKey | null = null;
      editor.read(() => {
        const node = $getNearestNodeFromDOMNode(anchor);
        nextNodeKey = isEditableInlineFormatNode(node) ? node.getKey() : null;
      });

      if (!nextNodeKey) {
        return null;
      }

      return {
        entrySide,
        nodeKey: nextNodeKey,
      };
    };

    const readActiveSourceNodeKeys = () =>
      editor.getEditorState().read(() =>
        $getRoot()
          .getAllTextNodes()
          .filter($isInlineFormatSourceNode)
          .map((node) => node.getKey())
      );

    const syncSourceSelection = (activation: InlineFormatActivation) => {
      queueMicrotask(() => {
        editor.update(() => {
          const sourceNode = $getNodeByKey(activation.nodeKey);
          if (!$isInlineFormatSourceNode(sourceNode)) {
            return;
          }
          const caretOffset = getInlineFormatEntryCaretOffset(sourceNode.getRaw(), activation.entrySide);
          sourceNode.select(caretOffset, caretOffset);
        }, {
          discrete: true,
          tag: COFLAT_NESTED_EDIT_TAG,
        });
        editor.focus();

        const syncDomSelection = (remainingFrames: number) => {
          requestAnimationFrame(() => {
            editor.update(() => {
              const sourceNode = $getNodeByKey(activation.nodeKey);
              if (!$isInlineFormatSourceNode(sourceNode)) {
                return;
              }
              const caretOffset = getInlineFormatEntryCaretOffset(sourceNode.getRaw(), activation.entrySide);
              sourceNode.select(caretOffset, caretOffset);
            }, {
              discrete: true,
              tag: COFLAT_NESTED_EDIT_TAG,
            });

            const rootElement = editor.getRootElement();
            const sourceElement = rootElement?.querySelector(".cf-lexical-inline-format-source");
            const textNode = sourceElement?.firstChild instanceof Text
              ? sourceElement.firstChild
              : null;
            const selection = window.getSelection();

            if (!(sourceElement instanceof HTMLElement) || !textNode || !selection) {
              if (remainingFrames > 0) {
                syncDomSelection(remainingFrames - 1);
                return;
              }
              pendingActivation = null;
              return;
            }

            const raw = normalizeInlineFormatSourceRaw(textNode.textContent ?? "");
            const caretOffset = getInlineFormatEntryCaretOffset(raw, activation.entrySide);
            const range = document.createRange();
            range.setStart(textNode, caretOffset);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            if (remainingFrames > 0) {
              syncDomSelection(remainingFrames - 1);
              return;
            }
            pendingActivation = null;
          });
        };

        syncDomSelection(3);
      });
    };

    const syncSourceCaret = (nodeKey: NodeKey, caretOffset: number) => {
      queueMicrotask(() => {
        editor.update(() => {
          const sourceNode = $getNodeByKey(nodeKey);
          if (!$isInlineFormatSourceNode(sourceNode)) {
            return;
          }
          sourceNode.select(
            Math.min(caretOffset, sourceNode.getRaw().length),
            Math.min(caretOffset, sourceNode.getRaw().length),
          );
        }, {
          discrete: true,
          tag: COFLAT_NESTED_EDIT_TAG,
        });
        editor.focus();

        requestAnimationFrame(() => {
          const rootElement = editor.getRootElement();
          if (!rootElement) {
            return;
          }
          const sourceElement = rootElement.querySelector<HTMLElement>(
            `.cf-lexical-inline-format-source[data-coflat-inline-format-source-key="${nodeKey}"]`,
          );
          const textNode = sourceElement?.firstChild instanceof Text
            ? sourceElement.firstChild
            : null;
          const selection = window.getSelection();
          if (!(sourceElement instanceof HTMLElement) || !textNode || !selection) {
            return;
          }
          const range = document.createRange();
          range.setStart(textNode, Math.min(caretOffset, textNode.textContent?.length ?? 0));
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        });
      });
    };

    const replaceSourceRange = (
      selectionOffsets: SourceSelectionOffsets,
      insertText: string,
    ) => {
      editor.update(() => {
        const sourceNode = $getNodeByKey(selectionOffsets.nodeKey);
        if (!$isInlineFormatSourceNode(sourceNode)) {
          return;
        }
        const raw = sourceNode.getRaw();
        const nextRaw = raw.slice(0, selectionOffsets.start) + insertText + raw.slice(selectionOffsets.end);
        sourceNode.setTextContent(toStoredInlineFormatSourceRaw(nextRaw));
      }, {
        discrete: true,
        tag: COFLAT_NESTED_EDIT_TAG,
      });
      syncSourceCaret(selectionOffsets.nodeKey, selectionOffsets.start + insertText.length);
    };

    const tryOpenAdjacentInlineFormat = (
      event: KeyboardEvent,
      isBackward: boolean,
      entrySide: EntrySide,
    ): boolean => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return false;
      }

      const adjacentActivation = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return null;
        }

        const adjacent = $getAdjacentNode(selection.anchor, isBackward);
        if (!isEditableInlineFormatNode(adjacent)) {
          return null;
        }

        return {
          entrySide,
          nodeKey: adjacent.getKey(),
        } satisfies InlineFormatActivation;
      });

      const fallbackAnchor = adjacentActivation
        ? null
        : findInlineFormatAnchorFromDomSelection(editor.getRootElement(), isBackward);
      const activation = adjacentActivation ?? (
        fallbackAnchor
          ? getActivationFromAnchor(fallbackAnchor, entrySide)
          : null
      );
      if (!activation) {
        return false;
      }

      event.preventDefault();
      if (!startEditing(activation.nodeKey, activation.entrySide)) {
        return false;
      }
      pendingActivation = activation;
      syncSourceSelection(activation);
      return true;
    };

    const readSelectedSourceNode = () =>
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return null;
        }

        const anchorNode = selection.anchor.getNode();
        if (!$isInlineFormatSourceNode(anchorNode)) {
          return null;
        }

        return {
          entrySide: anchorNode.getEntrySide(),
          nodeKey: anchorNode.getKey(),
          raw: anchorNode.getRaw(),
          selectionOffset: selection.anchor.offset,
        };
      });

    return mergeRegister(
      editor.registerCommand(
        KEY_ARROW_LEFT_COMMAND,
        (event) => {
          const activeNode = readSelectedSourceNode();
          if (activeNode) {
            if (!isInlineFormatRawBoundary(activeNode.raw, activeNode.selectionOffset, "before")) {
              return false;
            }

            event?.preventDefault();
            closeEditing(activeNode.nodeKey, { move: "before" });
            return true;
          }

          return tryOpenAdjacentInlineFormat(event, true, "end");
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        (event) => {
          const activeNode = readSelectedSourceNode();
          if (activeNode) {
            if (!isInlineFormatRawBoundary(activeNode.raw, activeNode.selectionOffset, "after")) {
              return false;
            }

            event?.preventDefault();
            closeEditing(activeNode.nodeKey, { move: "after" });
            return true;
          }

          return tryOpenAdjacentInlineFormat(event, false, "start");
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          const activeNode = readSelectedSourceNode();
          if (!activeNode) {
            return false;
          }

          event?.preventDefault();
          closeEditing(activeNode.nodeKey, { move: "after" });
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          const activeNode = readSelectedSourceNode();
          if (!activeNode) {
            return false;
          }

          event.preventDefault();
          closeEditing(activeNode.nodeKey, {
            move: activeNode.entrySide === "start" ? "before" : "after",
            restore: true,
          });
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerUpdateListener(({ tags }) => {
        if (tags.has(COFLAT_NESTED_EDIT_TAG)) {
          return;
        }

        const {
          activeSourceNodeKeys,
          nextActivation,
          selectedSourceNodeKey,
        } = editor.getEditorState().read(readInlineFormatState);

        if (selectedSourceNodeKey) {
          const inactiveSourceNodeKeys = activeSourceNodeKeys.filter((nodeKey) => nodeKey !== selectedSourceNodeKey);
          if (inactiveSourceNodeKeys.length > 0) {
            queueMicrotask(() => {
              closeActiveSources(inactiveSourceNodeKeys);
            });
          }
          return;
        }

        if (pendingActivation && activeSourceNodeKeys.includes(pendingActivation.nodeKey)) {
          return;
        }

        if (activeSourceNodeKeys.length > 0) {
          return;
        }

        if (!nextActivation || queuedNodeKey === nextActivation.nodeKey) {
          return;
        }

        queuedNodeKey = nextActivation.nodeKey;
        queueMicrotask(() => {
          queuedNodeKey = null;
          if (!startEditing(nextActivation.nodeKey, nextActivation.entrySide)) {
            return;
          }
          pendingActivation = nextActivation;
          syncSourceSelection(nextActivation);
        });
      }),
      editor.registerRootListener((rootElement, previousRootElement) => {
        const detach = (element: HTMLElement | null) => {
          if (!element) {
            return;
          }
          element.removeEventListener("beforeinput", handleBeforeInput, true);
          element.removeEventListener("keydown", handleKeyDown, true);
          element.removeEventListener("mousedown", handleMouseDown, true);
          element.removeEventListener("click", handleClick, true);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            const selectionOffsets = readSourceSelectionOffsets(rootElement);
            if (!selectionOffsets && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
              const isBackward = event.key === "ArrowLeft";
              const anchor = findInlineFormatAnchorFromDomSelection(rootElement, isBackward);
              const activation = anchor
                ? getActivationFromAnchor(anchor, isBackward ? "end" : "start")
                : null;
              if (activation && startEditing(activation.nodeKey, activation.entrySide)) {
                event.preventDefault();
                event.stopPropagation();
                pendingActivation = activation;
                syncSourceSelection(activation);
                return;
              }
            }
          }

          if (event.key !== "Backspace" && event.key !== "Delete") {
            return;
          }

          const selectionOffsets = readSourceSelectionOffsets(rootElement);
          if (!selectionOffsets) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          if (selectionOffsets.start !== selectionOffsets.end) {
            replaceSourceRange(selectionOffsets, "");
            return;
          }

          if (event.key === "Backspace") {
            if (selectionOffsets.start === 0) {
              return;
            }
            replaceSourceRange({
              ...selectionOffsets,
              start: selectionOffsets.start - 1,
            }, "");
            return;
          }

          editor.getEditorState().read(() => {
            const sourceNode = $getNodeByKey(selectionOffsets.nodeKey);
            if (!$isInlineFormatSourceNode(sourceNode) || selectionOffsets.end >= sourceNode.getRaw().length) {
              return;
            }
            replaceSourceRange({
              ...selectionOffsets,
              end: selectionOffsets.end + 1,
            }, "");
          });
        };

        const handleBeforeInput = (event: InputEvent) => {
          const selectionOffsets = readSourceSelectionOffsets(rootElement);
          if (!selectionOffsets) {
            return;
          }

          if (event.inputType === "insertText" || event.inputType === "insertCompositionText") {
            event.preventDefault();
            event.stopPropagation();
            replaceSourceRange(selectionOffsets, event.data ?? "");
            return;
          }

          if (event.inputType === "deleteContentBackward") {
            event.preventDefault();
            event.stopPropagation();
            if (selectionOffsets.start !== selectionOffsets.end) {
              replaceSourceRange(selectionOffsets, "");
              return;
            }
            if (selectionOffsets.start === 0) {
              return;
            }
            replaceSourceRange({
              ...selectionOffsets,
              start: selectionOffsets.start - 1,
            }, "");
            return;
          }

          if (event.inputType === "deleteContentForward") {
            event.preventDefault();
            event.stopPropagation();
            if (selectionOffsets.start !== selectionOffsets.end) {
              replaceSourceRange(selectionOffsets, "");
              return;
            }
            editor.getEditorState().read(() => {
              const sourceNode = $getNodeByKey(selectionOffsets.nodeKey);
              if (!$isInlineFormatSourceNode(sourceNode) || selectionOffsets.end >= sourceNode.getTextContentSize()) {
                return;
              }
              replaceSourceRange({
                ...selectionOffsets,
                end: selectionOffsets.end + 1,
              }, "");
            });
          }
        };

        const handleMouseDown = (event: MouseEvent) => {
          const anchor = resolveInlineFormatAnchor(event.target);
          if (!anchor) {
            const activeSourceNodeKeys = readActiveSourceNodeKeys();
            const targetNode = event.target instanceof Node ? event.target : null;
            const sourceElement = targetNode instanceof Element
              ? targetNode.closest(".cf-lexical-inline-format-source")
              : null;
            if (!sourceElement && activeSourceNodeKeys.length > 0) {
              closeActiveSources(activeSourceNodeKeys);
            }
            return;
          }

          const ownerRoot = anchor.closest<HTMLElement>(".cf-lexical-editor");
          if (ownerRoot !== rootElement) {
            return;
          }

          const rect = anchor.getBoundingClientRect();
          const entrySide: EntrySide = event.clientX <= rect.left + rect.width / 2 ? "start" : "end";
          const activation = getActivationFromAnchor(anchor, entrySide);
          if (!activation) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          if (!startEditing(activation.nodeKey, activation.entrySide)) {
            return;
          }
          pendingActivation = activation;
          syncSourceSelection(activation);
        };

        const handleClick = (event: MouseEvent) => {
          if (!pendingActivation) {
            return;
          }

          const targetNode = event.target instanceof Node ? event.target : null;
          if (!(rootElement instanceof HTMLElement) || !targetNode || !rootElement.contains(targetNode)) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          syncSourceSelection(pendingActivation);
        };

        detach(previousRootElement);

        if (!rootElement) {
          return;
        }

        rootElement.addEventListener("beforeinput", handleBeforeInput, true);
        rootElement.addEventListener("keydown", handleKeyDown, true);
        rootElement.addEventListener("mousedown", handleMouseDown, true);
        rootElement.addEventListener("click", handleClick, true);
        return () => {
          detach(rootElement);
        };
      }),
    );
  }, [closeActiveSources, closeEditing, editor, startEditing]);

  return null;
}
