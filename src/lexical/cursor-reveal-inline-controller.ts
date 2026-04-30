import {
  $addUpdateTag,
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type TextNode,
} from "lexical";
import type { RevealAdapter } from "./cursor-reveal-adapters";
import type { CursorRevealOpenRequest } from "./cursor-reveal-controller";
import type { CursorRevealLifecycleRef } from "./cursor-reveal-lifecycle";
import {
  beginRevealCommit,
  finishRevealClose,
} from "./cursor-reveal-lifecycle";
import {
  getCursorRevealSession,
  isCursorRevealOpening,
  openCursorReveal,
  type CursorRevealMachineState,
} from "./cursor-reveal-machine";
import type { InlineRevealChromeState } from "./cursor-reveal-inline-presentation";
import { $isFootnoteReferenceNode } from "./nodes/footnote-reference-node";
import { $isInlineImageNode } from "./nodes/inline-image-node";
import { $isInlineMathNode } from "./nodes/inline-math-node";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import { $isReferenceNode } from "./nodes/reference-node";
import { REVEAL_SOURCE_TEXT_STYLE } from "./reveal-source-style";
import {
  COFLAT_REVEAL_COMMIT_TAG,
  COFLAT_REVEAL_UI_TAG,
} from "./update-tags";

export interface InlineRevealSession {
  readonly plainKey: NodeKey;
  readonly adapter: RevealAdapter;
  readonly caretOffset: number;
  readonly source: string;
  readonly sourceFormat: number;
}

interface InlineRevealCommitResult {
  readonly replacement: LexicalNode | null;
  readonly sourceChanged: boolean;
}

export function anchorTextKey(selection: ReturnType<typeof $getSelection>): NodeKey | null {
  if (!selection || !("anchor" in selection)) {
    return null;
  }
  // RangeSelection only - NodeSelection has no concept of "still inside".
  const anchor = (selection as { anchor: { getNode: () => unknown } }).anchor;
  const node = anchor.getNode();
  return node && typeof (node as { getKey?: () => string }).getKey === "function"
    ? (node as { getKey: () => string }).getKey()
    : null;
}

export function shouldSkipOpeningArrow(
  state: CursorRevealMachineState<InlineRevealSession>,
): boolean {
  return isCursorRevealOpening(state)
    && Date.now() <= state.suppressArrowUntil;
}

export function scheduleOpeningRevealSelectionSync(
  editor: LexicalEditor,
  activeRef: { current: CursorRevealMachineState<InlineRevealSession> },
): void {
  const active = getCursorRevealSession(activeRef.current);
  if (!active || !isCursorRevealOpening(activeRef.current)) {
    return;
  }
  queueMicrotask(() => {
    editor.update(() => {
      const latest = getCursorRevealSession(activeRef.current);
      if (!latest || latest.plainKey !== active.plainKey) {
        return;
      }
      const live = $getNodeByKey(latest.plainKey);
      restoreOpeningRevealSelection(activeRef.current, live);
    }, { discrete: true });
  });
}

export function restoreOpeningRevealSelection(
  state: CursorRevealMachineState<InlineRevealSession>,
  live: LexicalNode | null | undefined,
): boolean {
  const active = getCursorRevealSession(state);
  if (!active || !isCursorRevealOpening(state) || !$isTextNode(live)) {
    return false;
  }
  $addUpdateTag(COFLAT_REVEAL_UI_TAG);
  $setSelection(null);
  selectRevealText(live, active.caretOffset);
  return true;
}

export function selectRevealText(node: TextNode, offset: number): void {
  node.select(offset, offset);
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    selection.dirty = true;
    selection.setFormat(0);
    selection.setStyle(REVEAL_SOURCE_TEXT_STYLE);
  }
}

function isBlockRevealSubject(node: LexicalNode): boolean {
  if ($isRawBlockNode(node)) {
    return true;
  }
  return $isElementNode(node) && !node.isInline();
}

/**
 * Replace the subject node with a plain-text node containing its markdown
 * source, then position the caret inside. Records the key + adapter via
 * `activeRef` while still inside Lexical's command/update context.
 */
export function openInlineReveal(
  request: CursorRevealOpenRequest,
  adapter: RevealAdapter,
  activeRef: { current: CursorRevealMachineState<InlineRevealSession> },
  setChromeState: (state: InlineRevealChromeState | null) => void,
): void {
  const live = $getNodeByKey(request.nodeKey);
  if (!live) {
    return;
  }
  const phase = $isDecoratorNode(live)
    ? "opening"
    : "editing";
  const sourceFormat = getSourceBackedFormat(live);
  const plain = $createTextNode(request.source);
  $addUpdateTag(COFLAT_REVEAL_UI_TAG);
  // Source reveals must stay visually distinct and must not merge with
  // neighboring prose TextNodes, otherwise we lose the key used to commit.
  plain.setStyle(REVEAL_SOURCE_TEXT_STYLE);
  if (isBlockRevealSubject(live)) {
    // Block-scope reveal (paragraph adapter): the subject is a top-level block,
    // not an inline node. A bare TextNode at the root would violate Lexical's
    // structural invariants, so wrap the placeholder in a fresh ParagraphNode
    // and swap the whole block.
    const wrapper = $createParagraphNode();
    wrapper.append(plain);
    live.replace(wrapper);
  } else {
    live.replace(plain);
  }
  const caretOffset = Math.max(0, Math.min(request.caretOffset, plain.getTextContentSize()));
  selectRevealText(plain, caretOffset);
  const plainKey = plain.getKey();
  activeRef.current = openCursorReveal({
    adapter,
    caretOffset,
    plainKey,
    source: request.source,
    sourceFormat,
  }, phase, {
    suppressArrowUntil: request.entry === "keyboard-boundary" ? Date.now() + 100 : 0,
  });
  setChromeState(
    adapter.getChromePreview?.(request.source)
      ? { adapter, plainKey, source: request.source }
      : null,
  );
}

function getSourceBackedFormat(node: LexicalNode): number {
  if (
    $isInlineMathNode(node)
    || $isInlineImageNode(node)
    || $isReferenceNode(node)
    || $isFootnoteReferenceNode(node)
  ) {
    return node.getFormat();
  }
  return 0;
}

export function commitAndCloseInlineReveal(
  lifecycleRef: CursorRevealLifecycleRef<InlineRevealSession>,
  session: InlineRevealSession,
): InlineRevealCommitResult {
  beginRevealCommit(lifecycleRef);
  const commit = $commitInlineReveal(session);
  finishRevealClose(lifecycleRef);
  return commit;
}

function $commitInlineReveal(handle: InlineRevealSession): InlineRevealCommitResult {
  const live = $getNodeByKey(handle.plainKey);
  if (!$isTextNode(live)) {
    return {
      replacement: null,
      sourceChanged: false,
    };
  }
  const nextSource = live.getTextContent();
  const sourceChanged = nextSource !== handle.source;
  if (sourceChanged) {
    $addUpdateTag(COFLAT_REVEAL_COMMIT_TAG);
  } else {
    $addUpdateTag(COFLAT_REVEAL_UI_TAG);
  }
  live.setFormat(handle.sourceFormat);
  const replacement = handle.adapter.reparse(live, nextSource);
  return {
    replacement,
    sourceChanged,
  };
}
