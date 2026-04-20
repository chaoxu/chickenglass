import {
  $isTextNode,
} from "lexical";

import {
  type RevealAdapter,
  type RevealSubject,
} from "./cursor-reveal-adapters";
import {
  OPEN_CURSOR_REVEAL_COMMAND,
  type CursorRevealOpenRequest,
} from "./cursor-reveal-command";

export { OPEN_CURSOR_REVEAL_COMMAND };
export type { CursorRevealOpenRequest };

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
