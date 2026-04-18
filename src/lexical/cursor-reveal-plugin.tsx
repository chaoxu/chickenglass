/**
 * Cursor-scope reveal plugin: when the caret lands inside a revealable
 * subtree (styled TextNode, link, inline math, citation, footnote ref),
 * surface the raw markdown so the user can edit the marker + content
 * directly. Two presentations are supported and picked via the
 * `presentation` prop, driven by `Settings.revealPresentation`:
 *
 * - **Floating**: open a `SurfaceFloatingPortal` anchored to the live
 *   subtree. The original Lexical node is untouched; Enter / blur
 *   commits the draft, Escape discards.
 *
 * - **Inline** (Typora-style): swap the live subtree in place for a
 *   plain TextNode whose text is the markdown source. The user edits
 *   it directly in the document flow. When the caret leaves that run,
 *   the text is re-parsed via the same adapter — valid syntax becomes
 *   the original kind of node, anything else stays plain text.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isTextNode,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from "lexical";

import {
  EDITOR_MODE,
  REVEAL_PRESENTATION,
  type EditorMode,
  type RevealPresentation,
} from "../app/editor-mode";
import { SurfaceFloatingPortal } from "../lexical-next";
import {
  PARAGRAPH_REVEAL_ADAPTERS,
  REVEAL_ADAPTERS,
  pickRevealSubject,
  type RevealAdapter,
  type RevealSubject,
} from "./cursor-reveal-adapters";
import { EditorChromeBody, EditorChromeInput, EditorChromePanel } from "./editor-chrome";
import { inlineMathSourceOffsetFromTarget } from "./math-source-position";
import { $isFootnoteReferenceNode } from "./nodes/footnote-reference-node";
import { $isInlineMathNode } from "./nodes/inline-math-node";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import { $isReferenceNode } from "./nodes/reference-node";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";

// Re-exports kept so existing unit tests can continue importing the
// pure markdown helpers from this module.
export { wrapWithSpecs, unwrapSource } from "./cursor-reveal-adapters";

export function CursorRevealPlugin({
  editorMode,
  presentation,
}: {
  editorMode: EditorMode;
  presentation: RevealPresentation;
}) {
  // Mode picks the *scope* (which subtree the cursor surfaces); presentation
  // picks *where* the editable surface lives. PARAGRAPH mode swaps the
  // per-element adapters for a single paragraph adapter so the whole block
  // opens as one source surface instead of just the inline token under the
  // caret. SOURCE mode never reaches this plugin (it mounts PlainTextPlugin).
  const adapters = editorMode === EDITOR_MODE.PARAGRAPH
    ? PARAGRAPH_REVEAL_ADAPTERS
    : REVEAL_ADAPTERS;
  if (presentation === REVEAL_PRESENTATION.INLINE) {
    return <InlineCursorReveal adapters={adapters} />;
  }
  return <FloatingCursorReveal adapters={adapters} />;
}

/**
 * Decorator nodes never receive range selections, and the browser's default
 * click handling stops at their DOM, so SELECTION_CHANGE never sees them.
 * This hook fires on any click, finds the nearest revealable decorator, and
 * hands its subject directly to the presentation via `onOpen`, bypassing the
 * SELECTION_CHANGE path we use for text-format and link reveals.
 */
function useDecoratorClickEntry(
  editor: LexicalEditor,
  adapters: readonly RevealAdapter[],
  onOpen: (subject: RevealSubject, adapter: RevealAdapter, event: MouseEvent) => void,
): void {
  useEffect(() => {
    return editor.registerCommand(
      CLICK_COMMAND,
      (event) => {
        if (!(event.target instanceof Node)) {
          return false;
        }
        const target = event.target;
        const pendingRef: { value: { subject: RevealSubject; adapter: RevealAdapter } | null } = { value: null };
        editor.read(() => {
          const node = $getNearestNodeFromDOMNode(target);
          if (!node || !isRevealableDecorator(node)) {
            return;
          }
          const selection = $createNodeSelection();
          selection.add(node.getKey());
          const pick = pickRevealSubject(selection, adapters);
          if (!pick) {
            return;
          }
          pendingRef.value = { adapter: pick.adapter, subject: pick.subject };
        });
        const opened = pendingRef.value;
        if (!opened) {
          return false;
        }
        // Deferring escapes the editor.read context so the presentation can
        // run a discrete editor.update without hitting "empty pending editor
        // state on discrete nested update".
        setTimeout(() => onOpen(opened.subject, opened.adapter, event), 0);
        event.preventDefault();
        event.stopPropagation();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onOpen, adapters]);
}

function isRevealableDecorator(node: LexicalNode): boolean {
  return $isInlineMathNode(node)
    || $isReferenceNode(node)
    || $isFootnoteReferenceNode(node)
    // Block-scope decorator (e.g. theorem) — only the paragraph adapter
    // claims it, so in cursor mode this is a no-op (pickRevealSubject
    // returns null and nothing happens). In paragraph mode the click
    // produces a NodeSelection that the paragraph adapter handles.
    || $isRawBlockNode(node);
}

// ─── Floating presentation ──────────────────────────────────────────────

interface FloatingState {
  readonly nodeKey: NodeKey;
  readonly anchor: HTMLElement;
  readonly adapter: RevealAdapter;
  readonly caretOffset: number;
}

function FloatingCursorReveal({ adapters }: { adapters: readonly RevealAdapter[] }) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<FloatingState | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Key we last revealed (or committed to). Prevents the floating editor
  // from reopening on the same node right after it closes, since Lexical's
  // post-commit selection still points at the replacement node.
  const lastRevealedKeyRef = useRef<NodeKey | null>(null);

  const openFloating = useCallback(
    (subject: RevealSubject, adapter: RevealAdapter, caretOffset = subject.source.length) => {
      const key = subject.node.getKey();
      if (key === lastRevealedKeyRef.current) {
        return;
      }
      const dom = editor.getElementByKey(key);
      if (!dom) {
        return;
      }
      lastRevealedKeyRef.current = key;
      setDraft(subject.source);
      setState({ adapter, anchor: dom, caretOffset, nodeKey: key });
    },
    [editor],
  );

  const openFloatingFromDecoratorClick = useCallback((
    subject: RevealSubject,
    adapter: RevealAdapter,
    event: MouseEvent,
  ) => {
    openFloating(subject, adapter, clickCaretOffset(subject, event) ?? subject.source.length);
  }, [openFloating]);

  useDecoratorClickEntry(editor, adapters, openFloatingFromDecoratorClick);

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        const sel = $getSelection();
        if (!sel) {
          return false;
        }
        const pick = pickRevealSubject(sel, adapters);
        if (!pick) {
          lastRevealedKeyRef.current = null;
          return false;
        }
        openFloating(pick.subject, pick.adapter);
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, openFloating, adapters]);

  useEffect(() => {
    if (!state) {
      return;
    }
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    const offset = Math.max(0, Math.min(state.caretOffset, input.value.length));
    input.setSelectionRange(offset, offset);
  }, [state]);

  const commitDraft = (current: FloatingState, nextRaw: string) => {
    editor.update(() => {
      const node = $getNodeByKey(current.nodeKey);
      if (!node) {
        return;
      }
      // The user's selection may still point inside the node we are about to
      // remove (e.g. clicking a link briefly placed a Lexical selection inside
      // it before focus moved to the floating input). Drop the live selection
      // before the swap so Lexical doesn't throw "selection has been lost…"
      // when reconciling the removed subtree.
      $setSelection(null);
      // Floating mode never plain-swaps the subtree, so adapters expect a
      // TextNode they can replace. Wrap the live node in a sacrificial
      // TextNode and let the adapter rebuild from `nextRaw`.
      const placeholder = $createTextNode(nextRaw);
      node.replace(placeholder);
      const replacement = current.adapter.reparse(placeholder, nextRaw);
      lastRevealedKeyRef.current = replacement.getKey();
    }, { discrete: true, tag: COFLAT_NESTED_EDIT_TAG });
  };

  if (!state) {
    return null;
  }

  const widthCh = Math.max(3, draft.length + 1);

  return (
    <SurfaceFloatingPortal anchor={state.anchor} offsetPx={8}>
      <EditorChromePanel className="cf-lexical-floating-source-shell cf-lexical-inline-token-panel-shell">
        <EditorChromeBody className="cf-lexical-floating-source-surface cf-lexical-inline-token-panel-surface">
          <EditorChromeInput
            ref={inputRef}
            className="cf-lexical-inline-token-source cf-lexical-floating-source-editor cf-lexical-inline-token-panel-editor"
            onBlur={() => {
              commitDraft(state, draft);
              flushSync(() => setState(null));
            }}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitDraft(state, draft);
                setState(null);
              } else if (event.key === "Escape") {
                event.preventDefault();
                lastRevealedKeyRef.current = state.nodeKey;
                setState(null);
              }
            }}
            size={widthCh}
            style={{
              width: `min(calc(100vw - 8px), calc(${widthCh}ch + 0.2rem))`,
            }}
            value={draft}
          />
        </EditorChromeBody>
      </EditorChromePanel>
    </SurfaceFloatingPortal>
  );
}

// ─── Inline (Typora-style) presentation ─────────────────────────────────

interface InlineRevealHandle {
  readonly plainKey: NodeKey;
  readonly adapter: RevealAdapter;
}

function InlineCursorReveal({ adapters }: { adapters: readonly RevealAdapter[] }) {
  const [editor] = useLexicalComposerContext();
  // Key of the in-flight plain-text reveal node. When the caret moves off
  // this key, we reparse it via the same adapter that opened it.
  const activeRef = useRef<InlineRevealHandle | null>(null);

  const openFromDecoratorClick = useCallback(
    (subject: RevealSubject, adapter: RevealAdapter, event: MouseEvent) => {
      openInlineReveal(
        editor,
        subject,
        adapter,
        clickCaretOffset(subject, event) ?? subject.source.length,
        activeRef,
      );
    },
    [editor],
  );

  useDecoratorClickEntry(editor, adapters, openFromDecoratorClick);

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        const sel = $getSelection();
        if (!sel) {
          return false;
        }

        // If a reveal is open and the selection is still inside that
        // node, do nothing. Selection-change while inside the reveal
        // (typing, arrow within) shouldn't disturb it.
        if (activeRef.current) {
          const anchorKey = anchorTextKey(sel);
          if (anchorKey && anchorKey === activeRef.current.plainKey) {
            return false;
          }
          // Caret moved off the reveal — commit and exit. The replacement
          // will trigger another SELECTION_CHANGE that we evaluate fresh.
          commitInlineReveal(editor, activeRef.current);
          activeRef.current = null;
          return false;
        }

        const pick = pickRevealSubject(sel, adapters);
        if (!pick) {
          return false;
        }
        const preferredOffset = "anchor" in sel ? (sel.anchor as { offset: number }).offset : 0;
        openInlineReveal(editor, pick.subject, pick.adapter, preferredOffset, activeRef);
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, adapters]);

  return null;
}

function anchorTextKey(selection: ReturnType<typeof $getSelection>): NodeKey | null {
  if (!selection || !("anchor" in selection)) {
    return null;
  }
  // RangeSelection only — NodeSelection has no concept of "still inside".
  const anchor = (selection as { anchor: { getNode: () => unknown } }).anchor;
  const node = anchor.getNode();
  return node && typeof (node as { getKey?: () => string }).getKey === "function"
    ? (node as { getKey: () => string }).getKey()
    : null;
}

function clickCaretOffset(subject: RevealSubject, event: MouseEvent): number | null {
  if ($isInlineMathNode(subject.node)) {
    return inlineMathSourceOffsetFromTarget(event.target, subject.source, event.clientX);
  }
  return null;
}

function isBlockRevealSubject(node: LexicalNode): boolean {
  if ($isRawBlockNode(node)) {
    return true;
  }
  return $isElementNode(node) && !node.isInline();
}

/**
 * Replace the subject node with a plain-text node containing its
 * markdown source, then position the caret inside. Records the key +
 * adapter via `activeRef` from inside the queued update — we can't
 * return synchronously because we're called from another command
 * handler.
 */
function openInlineReveal(
  editor: LexicalEditor,
  subject: RevealSubject,
  adapter: RevealAdapter,
  preferredOffset: number,
  activeRef: { current: InlineRevealHandle | null },
): void {
  const subjectKey = subject.node.getKey();
  const initialRaw = subject.source;
  const caretOffset = computeCaretOffset(subject, preferredOffset);
  editor.update(() => {
    const live = $getNodeByKey(subjectKey);
    if (!live) {
      return;
    }
    const plain = $createTextNode(initialRaw);
    // A non-empty style prevents Lexical from merging this plain node
    // with its unstyled siblings during normalization — without it the
    // reveal text immediately fuses into the surrounding paragraph and
    // we lose the key we use to find the run on commit. The CSS
    // variable is a no-op visually.
    plain.setStyle("--cf-reveal:1");
    if (isBlockRevealSubject(live)) {
      // Block-scope reveal (paragraph adapter): the subject is a
      // top-level block, not an inline node. A bare TextNode at the
      // root would violate Lexical's structural invariants, so wrap the
      // placeholder in a fresh ParagraphNode and swap the whole block.
      // `RawBlockNode` (theorem etc.) is a DecoratorBlockNode rather
      // than an ElementNode, so we cover that case explicitly. On
      // commit, the paragraph adapter walks `plain` up to this wrapper
      // and splices in the parsed blocks.
      const wrapper = $createParagraphNode();
      wrapper.append(plain);
      live.replace(wrapper);
    } else {
      live.replace(plain);
    }
    plain.select(caretOffset, caretOffset);
    activeRef.current = { adapter, plainKey: plain.getKey() };
  }, { discrete: true, tag: COFLAT_NESTED_EDIT_TAG });
}

/**
 * For text-format subjects, map the caret's offset within the visible
 * text to an offset inside the source string (skipping past the open
 * marker). For other subjects the offset is meaningless — land at end.
 */
function computeCaretOffset(subject: RevealSubject, preferredOffset: number): number {
  if (subject.caretOffset !== undefined) {
    // Adapter (typically the paragraph adapter) computed an explicit
    // offset within `source` — clamp and trust it.
    return Math.max(0, Math.min(subject.caretOffset, subject.source.length));
  }
  if (!$isTextNode(subject.node)) {
    return Math.max(0, Math.min(preferredOffset, subject.source.length));
  }
  const text = subject.node.getTextContent();
  const openMarkerLen = subject.source.length - text.length - (subject.source.length - text.length) / 2;
  // The wrap is symmetric (open + text + close), so the open length is
  // (source.length - text.length) / 2.
  const openLen = Math.max(0, Math.floor((subject.source.length - text.length) / 2));
  const clamped = Math.max(0, Math.min(preferredOffset, text.length));
  // openMarkerLen kept above for future asymmetric markers; ignore it.
  void openMarkerLen;
  return openLen + clamped;
}

function commitInlineReveal(editor: LexicalEditor, handle: InlineRevealHandle): void {
  editor.update(() => {
    const live = $getNodeByKey(handle.plainKey);
    if (!$isTextNode(live)) {
      return;
    }
    handle.adapter.reparse(live, live.getTextContent());
  }, { discrete: true, tag: COFLAT_NESTED_EDIT_TAG });
}
