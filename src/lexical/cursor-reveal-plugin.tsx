/**
 * Cursor-scope reveal plugin: when the caret lands inside a styled TextNode
 * (italic/bold/strikethrough/highlight/code), open a floating source editor
 * anchored to the run so the user can edit the raw markdown — add/remove
 * markers, change wording — and commit by pressing Enter, blurring, or
 * Escape (which discards).
 *
 * This is the cursor-scope + floating-presentation slice of the unified
 * reveal plan (`docs/design/inline-rendering-policy.md`,
 * plan: "Unified Reveal: scoped subtree source editing"). Inline-swap
 * presentation and paragraph/complete scopes are follow-up work; inline
 * math and link plugins keep their own (floating) surfaces for now.
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
  type NodeKey,
  type TextNode,
} from "lexical";

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

function wrapWithSpecs(text: string, specs: readonly InlineTextFormatSpec[]): string {
  const open = specs.map((s) => s.markdownOpen).join("");
  const close = [...specs].reverse().map((s) => s.markdownClose).join("");
  return `${open}${text}${close}`;
}

/**
 * Peel outermost known open/close marker pairs from a raw string.
 * Returns the inner text and the specs that wrapped it (outer-first).
 * Unknown or unbalanced markers leave the string as plain text.
 */
function unwrapSource(raw: string): {
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

interface RevealState {
  readonly nodeKey: NodeKey;
  readonly anchor: HTMLElement;
  readonly initialRaw: string;
}

export function CursorRevealPlugin() {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<RevealState | null>(null);
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
        setState({ anchor: dom, initialRaw: raw, nodeKey: key });
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

  const commitDraft = (current: RevealState, nextRaw: string) => {
    editor.update(() => {
      const node = $getNodeByKey(current.nodeKey);
      if (!$isTextNode(node)) {
        return;
      }
      const { text, specs } = unwrapSource(nextRaw);
      const replacement = $createTextNode(text);
      for (const spec of specs) {
        replacement.toggleFormat(spec.lexicalFormat);
      }
      node.replace(replacement);
      // Treat the replacement as the "last revealed" node so the selection
      // change that follows the replace does not immediately reopen us.
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
                // Don't commit — leave the original styled node as-is.
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
