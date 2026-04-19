import {
  $getNearestNodeFromDOMNode,
  $isDecoratorNode,
  $isTextNode,
  CLICK_COMMAND,
  COMMAND_PRIORITY_HIGH,
  createCommand,
  type LexicalEditor,
  type NodeKey,
} from "lexical";

import {
  directionFromHorizontalArrowKey,
  findAdjacentInlineDecoratorElementFromDomSelection,
  hasNavigationModifier,
  type BoundaryDirection,
} from "./boundary-navigation";
import {
  pickRevealSubjectFromNode,
  type RevealAdapter,
  type RevealSubject,
} from "./cursor-reveal-adapters";

export interface CursorRevealOpenRequest {
  readonly adapterId: string;
  readonly caretOffset: number;
  readonly entry: "keyboard-boundary" | "pointer" | "selection";
  readonly nodeKey: NodeKey;
  readonly source: string;
}

export const OPEN_CURSOR_REVEAL_COMMAND = createCommand<CursorRevealOpenRequest>(
  "OPEN_CURSOR_REVEAL_COMMAND",
);

export function createRevealOpenRequest(
  subject: RevealSubject,
  adapter: RevealAdapter,
  preferredOffset: number,
  entry: CursorRevealOpenRequest["entry"] = "selection",
): CursorRevealOpenRequest {
  return {
    adapterId: adapter.id,
    caretOffset: computeCaretOffset(subject, preferredOffset),
    entry,
    nodeKey: subject.node.getKey(),
    source: subject.source,
  };
}

export function findRevealAdapter(
  adapters: readonly RevealAdapter[],
  adapterId: string,
): RevealAdapter | null {
  return adapters.find((adapter) => adapter.id === adapterId) ?? null;
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

  document.addEventListener("keydown", onKeyDown, true);
  return () => {
    document.removeEventListener("keydown", onKeyDown, true);
  };
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

/**
 * For text-format subjects, map the caret's offset within the visible text to
 * an offset inside the source string. Other adapters either supply an explicit
 * offset or use the preferred offset from the entry request.
 */
function computeCaretOffset(subject: RevealSubject, preferredOffset: number): number {
  if (subject.caretOffset !== undefined) {
    return Math.max(0, Math.min(subject.caretOffset, subject.source.length));
  }
  if (!$isTextNode(subject.node)) {
    return Math.max(0, Math.min(preferredOffset, subject.source.length));
  }
  const text = subject.node.getTextContent();
  const openLen = Math.max(0, Math.floor((subject.source.length - text.length) / 2));
  const clamped = Math.max(0, Math.min(preferredOffset, text.length));
  return openLen + clamped;
}
