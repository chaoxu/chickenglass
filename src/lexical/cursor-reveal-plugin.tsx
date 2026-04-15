/**
 * Cursor-scope reveal plugin: when the caret lands inside a styled TextNode
 * (italic/bold/strikethrough/highlight/code), surface the raw markdown so the
 * user can edit the marker + wording directly.
 *
 * Two presentations are supported and picked via the `presentation` prop,
 * which is driven by `Settings.revealPresentation`:
 *
 * - **Floating** (default for math/links today): open a
 *   `SurfaceFloatingPortal` anchored to the styled run. The original Lexical
 *   node is untouched; Enter/blur commits the draft, Escape discards.
 *
 * - **Inline** (Typora-style): swap the styled TextNode in place for a plain
 *   TextNode whose text is `*...*` / `**...**` / etc. The user edits it
 *   directly in the document flow. When the caret leaves that run, its text
 *   is re-parsed — known open/close marker pairs become format flags on the
 *   replacement node, anything else stays plain text.
 *
 * This is the cursor-scope slice of the unified reveal plan; paragraph and
 * complete scopes are follow-up work. Inline math and link plugins still
 * own their own floating surfaces for now.
 */
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
  type LexicalEditor,
  type NodeKey,
  type TextNode,
} from "lexical";

import { REVEAL_PRESENTATION, type RevealPresentation } from "../app/editor-mode";
import { SurfaceFloatingPortal } from "../lexical-next";
import {
  getInlineTextFormatSpecs,
  type InlineTextFormatSpec,
} from "../lexical-next/model/inline-text-format-family";
import { EditorChromeBody, EditorChromeInput, EditorChromePanel } from "./editor-chrome";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";

function activeFormatSpecs(node: TextNode): readonly InlineTextFormatSpec[] {
  return getInlineTextFormatSpecs().filter((spec) => node.hasFormat(spec.lexicalFormat));
}

export function wrapWithSpecs(text: string, specs: readonly InlineTextFormatSpec[]): string {
  const open = specs.map((s) => s.markdownOpen).join("");
  const close = [...specs].reverse().map((s) => s.markdownClose).join("");
  return `${open}${text}${close}`;
}

/**
 * Peel outermost known open/close marker pairs from a raw string.
 * Returns the inner text and the specs that wrapped it (outer-first).
 * Unknown or unbalanced markers leave the string as plain text.
 */
export function unwrapSource(raw: string): {
  readonly text: string;
  readonly specs: readonly InlineTextFormatSpec[];
} {
  const specs: InlineTextFormatSpec[] = [];
  let text = raw;
  let peeled = true;
  while (peeled) {
    peeled = false;
    for (const spec of getInlineTextFormatSpecs()) {
      const min = spec.markdownOpen.length + spec.markdownClose.length;
      if (
        text.length >= min + 1 &&
        text.startsWith(spec.markdownOpen) &&
        text.endsWith(spec.markdownClose)
      ) {
        text = text.slice(spec.markdownOpen.length, text.length - spec.markdownClose.length);
        specs.push(spec);
        peeled = true;
        break;
      }
    }
  }
  return { text, specs };
}

/**
 * Replace a live TextNode with the result of reparsing `raw` as markdown:
 * inner text as the new node's content, outer markers become format flags.
 * Returns the replacement node so callers can track its key.
 */
function $reparseTextNodeFromSource(live: TextNode, raw: string): TextNode {
  const { text, specs } = unwrapSource(raw);
  const replacement = $createTextNode(text);
  for (const spec of specs) {
    replacement.toggleFormat(spec.lexicalFormat);
  }
  live.replace(replacement);
  return replacement;
}

export function CursorRevealPlugin({ presentation }: { presentation: RevealPresentation }) {
  if (presentation === REVEAL_PRESENTATION.INLINE) {
    return <InlineCursorReveal />;
  }
  return <FloatingCursorReveal />;
}

// ─── Floating presentation ──────────────────────────────────────────────

interface FloatingState {
  readonly nodeKey: NodeKey;
  readonly anchor: HTMLElement;
}

function FloatingCursorReveal() {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<FloatingState | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Key we last revealed (or committed to). Prevents the floating editor
  // from reopening on the same node right after it closes, since Lexical's
  // post-commit selection still points at the replacement TextNode.
  const lastRevealedKeyRef = useRef<NodeKey | null>(null);

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) {
          return false;
        }
        const node = sel.anchor.getNode();
        if (!$isTextNode(node)) {
          lastRevealedKeyRef.current = null;
          return false;
        }
        const key = node.getKey();
        if (key === lastRevealedKeyRef.current) {
          return false;
        }
        lastRevealedKeyRef.current = key;
        const specs = activeFormatSpecs(node);
        if (specs.length === 0) {
          return false;
        }
        const raw = wrapWithSpecs(node.getTextContent(), specs);
        const dom = editor.getElementByKey(key);
        if (!dom) {
          return false;
        }
        setDraft(raw);
        setState({ anchor: dom, nodeKey: key });
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  useEffect(() => {
    if (!state) {
      return;
    }
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    const len = input.value.length;
    input.setSelectionRange(len, len);
  }, [state]);

  const commitDraft = (current: FloatingState, nextRaw: string) => {
    editor.update(() => {
      const node = $getNodeByKey(current.nodeKey);
      if (!$isTextNode(node)) {
        return;
      }
      const replacement = $reparseTextNodeFromSource(node, nextRaw);
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
}

function InlineCursorReveal() {
  const [editor] = useLexicalComposerContext();
  // Key of the in-flight plain-text reveal node. When the caret moves off
  // this key, we reparse it back into a styled TextNode.
  const activeRef = useRef<InlineRevealHandle | null>(null);

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) {
          return false;
        }
        const anchorNode = sel.anchor.getNode();
        if (!$isTextNode(anchorNode)) {
          // Caret left a text node entirely — commit any active reveal.
          if (activeRef.current) {
            commitInlineReveal(editor, activeRef.current);
            activeRef.current = null;
          }
          return false;
        }
        const anchorKey = anchorNode.getKey();

        // Still sitting inside the active reveal — nothing to do.
        if (activeRef.current && activeRef.current.plainKey === anchorKey) {
          return false;
        }

        // Caret moved off the active reveal → commit it, then consider
        // whether the new location is itself a styled run that should open.
        if (activeRef.current) {
          commitInlineReveal(editor, activeRef.current);
          activeRef.current = null;
          // The commit replaced the plain node. Don't try to open a new
          // reveal on this selection-change tick — the replacement will
          // trigger another SELECTION_CHANGE which we'll evaluate fresh.
          return false;
        }

        const specs = activeFormatSpecs(anchorNode);
        if (specs.length === 0) {
          return false;
        }
        const textOffset = sel.anchor.offset;
        openInlineReveal(editor, anchorNode, specs, textOffset, activeRef);
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  return null;
}

/**
 * Replace a styled TextNode with a plain-text one containing its raw
 * markdown source (e.g. `*haha*`). Caret lands at the end of the raw text.
 * Returns a handle for later reparse.
 */
function openInlineReveal(
  editor: LexicalEditor,
  node: TextNode,
  specs: readonly InlineTextFormatSpec[],
  textOffset: number,
  activeRef: { current: InlineRevealHandle | null },
): void {
  const text = node.getTextContent();
  const initialRaw = wrapWithSpecs(text, specs);
  const openLen = specs.reduce((sum, s) => sum + s.markdownOpen.length, 0);
  // Map the caret offset inside the styled text to an offset inside the
  // raw source. Clamp so we never land inside an open/close marker.
  const clampedTextOffset = Math.max(0, Math.min(textOffset, text.length));
  const rawOffset = openLen + clampedTextOffset;
  // The update is queued (we're inside another command handler), so we
  // can't return the new key synchronously — record it via the ref the
  // selection-change handler reads on the next tick.
  editor.update(() => {
    const live = $getNodeByKey(node.getKey());
    if (!$isTextNode(live)) {
      return;
    }
    const plain = $createTextNode(initialRaw);
    // A non-empty style prevents Lexical from merging this node with its
    // unstyled siblings during normalization — without it, the plain
    // `*world*` immediately fuses into the surrounding paragraph text and
    // we lose the key we use to find the run on commit. The CSS variable
    // is a no-op visually.
    plain.setStyle("--cf-reveal:1");
    live.replace(plain);
    plain.select(rawOffset, rawOffset);
    activeRef.current = { plainKey: plain.getKey() };
  }, { discrete: true, tag: COFLAT_NESTED_EDIT_TAG });
}

/**
 * Take whatever the plain-text reveal node now contains, run it through
 * `unwrapSource`, and replace it with a styled (or plain) TextNode.
 * No-op if the reveal node is gone (e.g. the block was deleted).
 */
function commitInlineReveal(editor: LexicalEditor, handle: InlineRevealHandle): void {
  editor.update(() => {
    const live = $getNodeByKey(handle.plainKey);
    if (!$isTextNode(live)) {
      return;
    }
    $reparseTextNodeFromSource(live, live.getTextContent());
  }, { discrete: true, tag: COFLAT_NESTED_EDIT_TAG });
}
