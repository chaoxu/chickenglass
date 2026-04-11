import { useCallback, useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $parseSerializedNode,
  BEFORE_INPUT_COMMAND,
  CLICK_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_DOWN_COMMAND,
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
import { $findAdjacentNodeAtSelectionBoundary } from "./selection-boundary";
import { getInlineTextFormatSelector, getInlineTextFormatSpecs } from "../lexical-next";

const INLINE_FORMAT_SPECS = getInlineTextFormatSpecs();
const INLINE_FORMAT_SELECTOR = getInlineTextFormatSelector();

function getInlineFormatDisplayClasses(node: {
  hasFormat: (format: "bold" | "italic" | "strikethrough" | "highlight" | "code") => boolean;
}): string[] {
  return INLINE_FORMAT_SPECS
    .filter((spec) => node.hasFormat(spec.lexicalFormat))
    .map((spec) => spec.themeClassName);
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

function readSourceSelectionOffsets(): SourceSelectionOffsets | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return null;
  }

  const anchorNode = selection.anchor.getNode();
  const focusNode = selection.focus.getNode();
  if (
    !$isInlineFormatSourceNode(anchorNode)
    || !$isInlineFormatSourceNode(focusNode)
    || anchorNode.getKey() !== focusNode.getKey()
  ) {
    return null;
  }

  const rawLength = anchorNode.getRaw().length;
  const anchorOffset = Math.min(selection.anchor.offset, rawLength);
  const focusOffset = Math.min(selection.focus.offset, rawLength);
  return {
    end: Math.max(anchorOffset, focusOffset),
    nodeKey: anchorNode.getKey(),
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

    const selectSourceCaret = (nodeKey: NodeKey, caretOffset: number): boolean => {
      let selected = false;
      editor.update(() => {
        const sourceNode = $getNodeByKey(nodeKey);
        if (!$isInlineFormatSourceNode(sourceNode)) {
          return;
        }

        const clampedOffset = Math.min(caretOffset, sourceNode.getRaw().length);
        sourceNode.select(clampedOffset, clampedOffset);
        selected = true;
      }, {
        discrete: true,
        tag: COFLAT_NESTED_EDIT_TAG,
      });
      return selected;
    };

    const syncSourceSelection = (activation: InlineFormatActivation) => {
      queueMicrotask(() => {
        const syncSelection = () => {
          const caretOffset = editor.getEditorState().read(() => {
            const sourceNode = $getNodeByKey(activation.nodeKey);
            return $isInlineFormatSourceNode(sourceNode)
              ? getInlineFormatEntryCaretOffset(sourceNode.getRaw(), activation.entrySide)
              : null;
          });
          return caretOffset == null
            ? false
            : selectSourceCaret(activation.nodeKey, caretOffset);
        };

        if (!syncSelection()) {
          pendingActivation = null;
          return;
        }

        editor.focus();

        const resyncSelection = (remainingFrames: number) => {
          requestAnimationFrame(() => {
            if (!syncSelection()) {
              pendingActivation = null;
              return;
            }

            if (remainingFrames > 0) {
              resyncSelection(remainingFrames - 1);
              return;
            }
            pendingActivation = null;
          });
        };

        resyncSelection(3);
      });
    };

    const syncSourceCaret = (nodeKey: NodeKey, caretOffset: number) => {
      queueMicrotask(() => {
        if (!selectSourceCaret(nodeKey, caretOffset)) {
          return;
        }
        editor.focus();

        requestAnimationFrame(() => {
          selectSourceCaret(nodeKey, caretOffset);
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

      const activation = editor.getEditorState().read(() => {
        const adjacent = $findAdjacentNodeAtSelectionBoundary(isBackward, isEditableInlineFormatNode);
        if (!adjacent) {
          return null;
        }

        return {
          entrySide,
          nodeKey: adjacent.getKey(),
        } satisfies InlineFormatActivation;
      });
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
      editor.registerCommand(
        BEFORE_INPUT_COMMAND,
        (event) => {
          const selectionOffsets = readSourceSelectionOffsets();
          if (!selectionOffsets) {
            return false;
          }

          if (event.inputType === "insertText" || event.inputType === "insertCompositionText") {
            event.preventDefault();
            event.stopPropagation();
            replaceSourceRange(selectionOffsets, event.data ?? "");
            return true;
          }

          if (event.inputType === "deleteContentBackward") {
            event.preventDefault();
            event.stopPropagation();
            if (selectionOffsets.start !== selectionOffsets.end) {
              replaceSourceRange(selectionOffsets, "");
              return true;
            }
            if (selectionOffsets.start === 0) {
              return true;
            }
            replaceSourceRange({
              ...selectionOffsets,
              start: selectionOffsets.start - 1,
            }, "");
            return true;
          }

          if (event.inputType === "deleteContentForward") {
            event.preventDefault();
            event.stopPropagation();
            if (selectionOffsets.start !== selectionOffsets.end) {
              replaceSourceRange(selectionOffsets, "");
              return true;
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
            return true;
          }

          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
          const selectionOffsets = readSourceSelectionOffsets();
          if (!selectionOffsets) {
            return false;
          }

          if (event.key !== "Backspace" && event.key !== "Delete") {
            return false;
          }

          event.preventDefault();
          event.stopPropagation();

          if (selectionOffsets.start !== selectionOffsets.end) {
            replaceSourceRange(selectionOffsets, "");
            return true;
          }

          if (event.key === "Backspace") {
            if (selectionOffsets.start === 0) {
              return true;
            }
            replaceSourceRange({
              ...selectionOffsets,
              start: selectionOffsets.start - 1,
            }, "");
            return true;
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
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        CLICK_COMMAND,
        (event) => {
          const rootElement = editor.getRootElement();
          if (!rootElement) {
            return false;
          }

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
            return false;
          }

          const ownerRoot = anchor.closest<HTMLElement>(".cf-lexical-editor");
          if (ownerRoot !== rootElement) {
            return false;
          }

          const rect = anchor.getBoundingClientRect();
          const entrySide: EntrySide = event.clientX <= rect.left + rect.width / 2 ? "start" : "end";
          const activation = getActivationFromAnchor(anchor, entrySide);
          if (!activation) {
            return false;
          }

          event.preventDefault();
          event.stopPropagation();
          if (!startEditing(activation.nodeKey, activation.entrySide)) {
            return true;
          }
          pendingActivation = activation;
          syncSourceSelection(activation);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
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
    );
  }, [closeActiveSources, closeEditing, editor, startEditing]);

  return null;
}
