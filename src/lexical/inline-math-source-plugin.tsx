import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createNodeSelection,
  $getAdjacentNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  mergeRegister,
  type NodeKey,
} from "lexical";

import { EditorChromeBody, EditorChromeInput, EditorChromePanel } from "./editor-chrome";
import { $isInlineMathNode } from "./nodes/inline-math-node";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";

type EntrySide = "start" | "end";
type ExitDirection = "before" | "after";

interface EditingState {
  readonly anchor: HTMLElement;
  readonly entrySide: EntrySide;
  readonly initialRaw: string;
  readonly nodeKey: NodeKey;
}

function resolveInlineMathAnchor(target: EventTarget | null): HTMLElement | null {
  const element = target instanceof HTMLElement
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  return element?.closest<HTMLElement>("[data-coflat-inline-math-key]") ?? null;
}

function selectorForNodeKey(nodeKey: NodeKey): string {
  const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(nodeKey)
    : nodeKey.replace(/[\\"]/g, "\\$&");
  return `[data-coflat-inline-math-key="${escaped}"]`;
}

function findInlineMathAnchor(rootElement: HTMLElement | null, nodeKey: NodeKey): HTMLElement | null {
  if (!rootElement) {
    return null;
  }
  return rootElement.querySelector<HTMLElement>(selectorForNodeKey(nodeKey));
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

function findInlineMathAnchorInNode(node: Node | null, isBackward: boolean): HTMLElement | null {
  if (!node) {
    return null;
  }

  if (node instanceof HTMLElement) {
    if (node.matches("[data-coflat-inline-math-key]")) {
      return node;
    }
    const matches = node.querySelectorAll<HTMLElement>("[data-coflat-inline-math-key]");
    if (matches.length > 0) {
      return isBackward ? matches[matches.length - 1] : matches[0];
    }
  }

  const child = isBackward ? node.lastChild : node.firstChild;
  return findInlineMathAnchorInNode(child, isBackward);
}

function findInlineMathAnchorFromDomSelection(
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
    return findInlineMathAnchorInNode(sibling, isBackward);
  }

  if (anchorNode instanceof Element) {
    const childIndex = isBackward ? selection.anchorOffset - 1 : selection.anchorOffset;
    if (childIndex >= 0 && childIndex < anchorNode.childNodes.length) {
      return findInlineMathAnchorInNode(anchorNode.childNodes[childIndex], isBackward);
    }
    const sibling = findBoundarySibling(rootElement, anchorNode, isBackward);
    return findInlineMathAnchorInNode(sibling, isBackward);
  }

  return null;
}

export function InlineMathSourcePlugin() {
  const [editor] = useLexicalComposerContext();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef(false);

  const updateMathRaw = useCallback((
    current: EditingState,
    nextRaw: string,
    options: { readonly discrete?: boolean } = {},
  ) => {
    editor.update(() => {
      const node = $getNodeByKey(current.nodeKey);
      if (!$isInlineMathNode(node) || node.getRaw() === nextRaw) {
        return;
      }
      node.setRaw(nextRaw);
    }, options.discrete
      ? {
          discrete: true,
          tag: COFLAT_NESTED_EDIT_TAG,
        }
      : {
          tag: COFLAT_NESTED_EDIT_TAG,
        });
  }, [editor]);

  const moveSelection = useCallback((nodeKey: NodeKey, direction: ExitDirection) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (!$isInlineMathNode(node)) {
        return;
      }
      const parent = node.getParent();
      if (!parent) {
        return;
      }
      const index = node.getIndexWithinParent();
      if (direction === "before") {
        parent.select(index, index);
        return;
      }
      parent.select(index + 1, index + 1);
    }, { discrete: true });
  }, [editor]);

  const startEditing = useCallback((
    nodeKey: NodeKey,
    entrySide: EntrySide,
    preferredAnchor: HTMLElement | null = null,
  ) => {
    const rootElement = editor.getRootElement();
    const anchor = preferredAnchor ?? findInlineMathAnchor(rootElement, nodeKey);
    if (!anchor) {
      return false;
    }

    const initialRaw = editor.getEditorState().read(() => {
      const node = $getNodeByKey(nodeKey);
      return $isInlineMathNode(node) ? node.getRaw() : null;
    });
    if (initialRaw == null) {
      return false;
    }

    setDraft(initialRaw);
    setEditing({
      anchor,
      entrySide,
      initialRaw,
      nodeKey,
    });
    return true;
  }, [editor]);

  const closeEditing = useCallback((
    current: EditingState,
    options: {
      readonly commit?: boolean;
      readonly nextRaw?: string;
      readonly move?: ExitDirection;
      readonly restoreRaw?: boolean;
    } = {},
  ) => {
    closingRef.current = true;
    if (options.commit) {
      updateMathRaw(current, options.nextRaw ?? draft, { discrete: true });
    }
    if (options.restoreRaw) {
      setDraft(current.initialRaw);
      updateMathRaw(current, current.initialRaw, { discrete: true });
    }
    flushSync(() => {
      setEditing(null);
    });
    if (options.move) {
      moveSelection(current.nodeKey, options.move);
      editor.focus();
    }
    queueMicrotask(() => {
      closingRef.current = false;
    });
  }, [draft, editor, moveSelection, updateMathRaw]);

  useEffect(() => {
    if (!editing) {
      setDraft("");
      return;
    }
    setDraft(editing.initialRaw);
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      return;
    }
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    const caret = editing.entrySide === "start" ? 0 : input.value.length;
    input.setSelectionRange(caret, caret);
  }, [editing]);

  useEffect(() => {
    const tooltip = tooltipRef.current;
    if (!editing || !tooltip) {
      return;
    }

    return autoUpdate(editing.anchor, tooltip, () => {
      void computePosition(editing.anchor, tooltip, {
        placement: "bottom-start",
        middleware: [offset(8), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        Object.assign(tooltip.style, {
          left: `${x}px`,
          top: `${y}px`,
        });
      });
    });
  }, [editing]);

  useEffect(() => {
    const tryOpenAdjacentInlineMath = (
      event: KeyboardEvent,
      isBackward: boolean,
      entrySide: EntrySide,
    ): boolean => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return false;
      }

      const adjacentNodeKey = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return null;
        }
        const adjacent = $getAdjacentNode(selection.anchor, isBackward);
        return $isInlineMathNode(adjacent) ? adjacent.getKey() : null;
      });
      const fallbackAnchor = adjacentNodeKey
        ? null
        : findInlineMathAnchorFromDomSelection(editor.getRootElement(), isBackward);
      const nextNodeKey = adjacentNodeKey ?? fallbackAnchor?.dataset.coflatInlineMathKey ?? null;
      if (!nextNodeKey) {
        return false;
      }

      event.preventDefault();
      editor.update(() => {
        const node = $getNodeByKey(nextNodeKey);
        if (!$isInlineMathNode(node)) {
          return;
        }
        const selection = $createNodeSelection();
        selection.add(nextNodeKey);
        $setSelection(selection);
      }, { discrete: true });

      return startEditing(nextNodeKey, entrySide, fallbackAnchor);
    };

    return mergeRegister(
      editor.registerCommand(
        KEY_ARROW_LEFT_COMMAND,
        (event) => tryOpenAdjacentInlineMath(event, true, "end"),
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        (event) => tryOpenAdjacentInlineMath(event, false, "start"),
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerRootListener((rootElement, previousRootElement) => {
        const detach = (element: HTMLElement | null) => {
          if (!element) {
            return;
          }
          element.removeEventListener("mousedown", handleMouseDown, true);
          element.removeEventListener("click", handleClick, true);
        };

        const handleMouseDown = (event: MouseEvent) => {
          const anchor = resolveInlineMathAnchor(event.target);
          if (!anchor) {
            return;
          }

          const ownerRoot = anchor.closest<HTMLElement>(".cf-lexical-editor");
          if (ownerRoot !== rootElement) {
            return;
          }

          const nodeKey = anchor.dataset.coflatInlineMathKey;
          if (!nodeKey) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          editor.update(() => {
            const node = $getNodeByKey(nodeKey);
            if (!$isInlineMathNode(node)) {
              return;
            }
            const selection = $createNodeSelection();
            selection.add(nodeKey);
            $setSelection(selection);
          }, { discrete: true });

          startEditing(nodeKey, "end", anchor);
        };

        const handleClick = (event: MouseEvent) => {
          const anchor = resolveInlineMathAnchor(event.target);
          if (!anchor) {
            return;
          }
          const ownerRoot = anchor.closest<HTMLElement>(".cf-lexical-editor");
          if (ownerRoot !== rootElement) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
        };

        detach(previousRootElement);

        if (!rootElement) {
          return;
        }

        rootElement.addEventListener("mousedown", handleMouseDown, true);
        rootElement.addEventListener("click", handleClick, true);
        return () => {
          detach(rootElement);
        };
      }),
    );
  }, [editor, startEditing]);

  if (!editing || typeof document === "undefined") {
    return null;
  }

  const inputWidthCh = Math.max(3, draft.length + 1);

  return createPortal(
    <div
      className="cf-lexical-inline-math-panel"
      ref={tooltipRef}
      style={{ position: "fixed", zIndex: 60 }}
    >
      <EditorChromePanel className="cf-lexical-floating-source-shell cf-lexical-inline-math-panel-shell">
        <EditorChromeBody className="cf-lexical-floating-source-surface cf-lexical-inline-math-panel-surface">
          <EditorChromeInput
            className="cf-lexical-inline-math-source cf-lexical-inline-math-panel-editor"
            onBlur={() => {
              if (closingRef.current) {
                return;
              }
              closeEditing(editing, {
                commit: true,
              });
            }}
            onChange={(event) => {
              const nextRaw = event.currentTarget.value;
              setDraft(nextRaw);
              updateMathRaw(editing, nextRaw);
            }}
            onKeyDown={(event) => {
              const selectionStart = event.currentTarget.selectionStart ?? 0;
              const selectionEnd = event.currentTarget.selectionEnd ?? 0;
              const atStart = selectionStart === 0 && selectionEnd === 0;
              const atEnd = selectionStart === draft.length && selectionEnd === draft.length;

              if (event.key === "ArrowLeft" && atStart) {
                event.preventDefault();
                closeEditing(editing, {
                  commit: true,
                  move: "before",
                });
                return;
              }

              if (event.key === "ArrowRight" && atEnd) {
                event.preventDefault();
                closeEditing(editing, {
                  commit: true,
                  move: "after",
                });
                return;
              }

              if (event.key === "Enter") {
                event.preventDefault();
                closeEditing(editing, {
                  commit: true,
                  move: "after",
                });
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                closeEditing(editing, {
                  move: editing.entrySide === "start" ? "before" : "after",
                  restoreRaw: true,
                });
              }
            }}
            ref={inputRef}
            size={inputWidthCh}
            style={{
              width: `min(calc(100vw - 8px), calc(${inputWidthCh}ch + 0.2rem))`,
            }}
            value={draft}
          />
        </EditorChromeBody>
      </EditorChromePanel>
    </div>,
    document.body,
  );
}
