/**
 * Reveal model shared across scopes (cursor / paragraph / complete) and
 * presentations (inline swap / floating portal).
 *
 * A "reveal" is the temporary surfacing of a subtree of the document AST as
 * raw markdown the user can edit. Each reveal has:
 *
 * - a scope: how much of the tree is surfaced (one inline run, one block, the
 *   whole document). Cursor-scope is the only implementation this file
 *   currently supports; paragraph/complete values exist for future use.
 * - a subject: the concrete Lexical node being revealed, its initial source
 *   text, and a reparse callback that writes the edited source back into the
 *   tree.
 * - a presentation: where the editable surface lives.
 *
 * Both presentations (inline / floating) read the same session state and
 * commit through the same reparse callback; they differ only in where the
 * editable input is rendered.
 */

import type { NodeKey } from "lexical";
import type { REVEAL_PRESENTATION } from "../../app/editor-mode";

export type RevealScope = "cursor" | "paragraph" | "complete";

export type RevealPresentationKind =
  (typeof REVEAL_PRESENTATION)[keyof typeof REVEAL_PRESENTATION];

/**
 * Which edge of the revealed run the caret entered from.
 * Used to position the caret inside the editable source on open.
 */
export type RevealEntrySide = "start" | "end" | "inside";

/**
 * Identifies a single revealable subtree. Produced by detectors (cursor
 * reveal plugin, click handler, arrow-key handler) and consumed by
 * presentations.
 */
export interface RevealSubject {
  readonly scope: RevealScope;
  /** Lexical key of the anchor node (the revealed subtree's root). */
  readonly nodeKey: NodeKey;
  /** Initial markdown source to populate the editable surface with. */
  readonly initialSource: string;
  /**
   * Opaque kind tag used by reparse to choose the right strategy.
   * E.g. "text-format:italic", "link", "inline-math".
   */
  readonly kind: string;
  /** Which side the caret entered from. */
  readonly entrySide: RevealEntrySide;
}

/**
 * Internal session state. One active session per editor at a time.
 */
export interface RevealSession {
  readonly subject: RevealSubject;
  readonly draft: string;
}
