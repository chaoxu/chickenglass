import { useEffect } from "react";
import {
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isDecoratorNode,
  CLICK_COMMAND,
  COMMAND_PRIORITY_HIGH,
  type LexicalEditor,
} from "lexical";

import {
  directionFromHorizontalArrowKey,
  findAdjacentInlineDecoratorElementFromDomSelection,
  hasNavigationModifier,
  type BoundaryDirection,
} from "./boundary-navigation";
import {
  pickRevealSubject,
  pickRevealSubjectFromNode,
  type RevealAdapter,
} from "./cursor-reveal-adapters";
import {
  createRevealOpenRequest,
  OPEN_CURSOR_REVEAL_COMMAND,
  type CursorRevealOpenRequest,
} from "./cursor-reveal-controller";
import { REVEAL_SOURCE_STYLE_PROPERTY } from "./reveal-source-style";

export function useUserDrivenSelectionReveal(
  editor: LexicalEditor,
  onIntent: () => void,
): void {
  useEffect(() => {
    const markUserSelectionIntent = (event: Event) => {
      const root = editor.getRootElement();
      const target = event.target instanceof Node ? event.target : null;
      const targetElement = target instanceof Element ? target : target?.parentElement ?? null;
      if (!root || !target || !root.contains(target) || targetElement?.closest("[contenteditable='true']") !== root) {
        return;
      }
      onIntent();
    };

    return editor.registerRootListener((rootElement, previousRootElement) => {
      previousRootElement?.removeEventListener("pointerdown", markUserSelectionIntent, true);
      previousRootElement?.removeEventListener("keydown", markUserSelectionIntent, true);
      if (!rootElement) {
        return;
      }
      rootElement.addEventListener("pointerdown", markUserSelectionIntent, true);
      rootElement.addEventListener("keydown", markUserSelectionIntent, true);
      return () => {
        rootElement.removeEventListener("pointerdown", markUserSelectionIntent, true);
        rootElement.removeEventListener("keydown", markUserSelectionIntent, true);
      };
    });
  }, [editor, onIntent]);
}

export function usePointerSelectionReveal(
  editor: LexicalEditor,
  adapters: readonly RevealAdapter[],
  canOpenReveal: (adapter: RevealAdapter) => boolean,
  onNoRevealCandidate: () => void,
): void {
  useEffect(() => {
    const handlePointerUp = (event: PointerEvent) => {
      const root = editor.getRootElement();
      const target = event.target instanceof Node ? event.target : null;
      const targetElement = target instanceof Element ? target : target?.parentElement ?? null;
      if (
        !root
        || !target
        || !root.contains(target)
        || targetElement?.closest("[contenteditable='true']") !== root
      ) {
        return;
      }
      window.setTimeout(() => {
        editor.update(() => {
          const selection = $getSelection();
          if (!selection) {
            onNoRevealCandidate();
            return;
          }
          const pick = pickRevealSubject(selection, adapters);
          if (!pick) {
            onNoRevealCandidate();
            return;
          }
          if (!canOpenReveal(pick.adapter)) {
            return;
          }
          const preferredOffset = "anchor" in selection
            ? (selection.anchor as { offset: number }).offset
            : pick.subject.caretOffset ?? pick.subject.source.length;
          editor.dispatchCommand(
            OPEN_CURSOR_REVEAL_COMMAND,
            createRevealOpenRequest(pick.subject, pick.adapter, preferredOffset),
          );
        }, { discrete: true });
      }, 0);
    };

    return editor.registerRootListener((rootElement, previousRootElement) => {
      previousRootElement?.removeEventListener("pointerup", handlePointerUp, true);
      if (!rootElement) {
        return;
      }
      rootElement.addEventListener("pointerup", handlePointerUp, true);
      return () => {
        rootElement.removeEventListener("pointerup", handlePointerUp, true);
      };
    });
  }, [adapters, canOpenReveal, editor, onNoRevealCandidate]);
}

export function registerDecoratorClickRevealEntry(
  editor: LexicalEditor,
  adapters: readonly RevealAdapter[],
  onOpen: (request: CursorRevealOpenRequest) => void,
): () => void {
  return editor.registerCommand(
    CLICK_COMMAND,
    (event) => {
      if (!(event.target instanceof Node)) {
        return false;
      }
      const node = $getNearestNodeFromDOMNode(event.target);
      if (!node || !$isDecoratorNode(node)) {
        return false;
      }
      const pick = pickRevealSubjectFromNode(
        node,
        {
          clientX: event.clientX,
          entry: "pointer",
          target: event.target,
        },
        adapters,
      );
      if (!pick) {
        return false;
      }
      const request = createRevealOpenRequest(
        pick.subject,
        pick.adapter,
        pick.subject.caretOffset ?? pick.subject.source.length,
        "pointer",
      );
      event.preventDefault();
      event.stopPropagation();
      onOpen(request);
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  );
}

export function registerDecoratorKeyboardBoundaryRevealEntry(
  editor: LexicalEditor,
  adapters: readonly RevealAdapter[],
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    const direction = directionFromHorizontalArrowKey(event.key);
    if (
      direction === null
      || hasNavigationModifier(event)
    ) {
      return;
    }

    const root = editor.getRootElement();
    const target = event.target instanceof Element ? event.target : null;
    if (!root || target?.closest("[contenteditable='true']") !== root) {
      return;
    }

    const request = findRevealRequestFromDomBoundary(editor, adapters, direction);
    if (!request) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    editor.dispatchCommand(OPEN_CURSOR_REVEAL_COMMAND, request);
  };

  return editor.registerRootListener((rootElement, previousRootElement) => {
    previousRootElement?.removeEventListener("keydown", onKeyDown, true);
    if (!rootElement) {
      return;
    }
    rootElement.addEventListener("keydown", onKeyDown, true);
    return () => {
      rootElement.removeEventListener("keydown", onKeyDown, true);
    };
  });
}

function findRevealRequestFromDomBoundary(
  editor: LexicalEditor,
  adapters: readonly RevealAdapter[],
  direction: BoundaryDirection,
): CursorRevealOpenRequest | null {
  const root = editor.getRootElement();
  const decorator = root
    ? findAdjacentInlineDecoratorElementFromDomSelection(root, direction)
    : null;
  if (!decorator) {
    return null;
  }

  let request: CursorRevealOpenRequest | null = null;
  editor.read(() => {
    const node = $getNearestNodeFromDOMNode(decorator);
    if (!node || !$isDecoratorNode(node) || !node.isInline()) {
      return;
    }
    const pick = pickRevealSubjectFromNode(
      node,
      { direction, entry: "keyboard-boundary" },
      adapters,
    );
    if (!pick) {
      return;
    }
    request = createRevealOpenRequest(
      pick.subject,
      pick.adapter,
      pick.subject.caretOffset ?? pick.subject.source.length,
      "keyboard-boundary",
    );
  });
  return request;
}

export function useDocumentKeyDownCapture(
  enabled: boolean,
  onKeyDown: (event: KeyboardEvent) => void,
): void {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [enabled, onKeyDown]);
}

export function useDocumentSelectionChange(
  enabled: boolean,
  onSelectionChange: () => void,
): void {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [enabled, onSelectionChange]);
}

export function domSelectionInsideRevealText(text: string): boolean {
  return getDomSelectionOffsetInsideRevealText(text) !== null;
}

export function getDomSelectionOffsetInsideRevealText(text: string): number | null {
  if (typeof document === "undefined") {
    return null;
  }
  const selection = document.getSelection();
  const anchor = selection?.anchorNode ?? null;
  if (!anchor) {
    return null;
  }
  const element = getLexicalTextElement(anchor);
  if (
    !element
    || element.textContent !== text
    || !element.style.getPropertyValue(REVEAL_SOURCE_STYLE_PROPERTY)
  ) {
    return null;
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  try {
    range.setEnd(anchor, selection?.anchorOffset ?? 0);
  } catch (_error) {
    return null;
  }
  return range.toString().length;
}

function getLexicalTextElement(anchor: Node | null): HTMLElement | null {
  if (!anchor) {
    return null;
  }
  const element = anchor instanceof HTMLElement
    ? anchor
    : anchor.parentElement;
  return element?.closest<HTMLElement>("[data-lexical-text='true']") ?? null;
}
