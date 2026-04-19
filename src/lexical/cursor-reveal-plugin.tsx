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
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { flushSync } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
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
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
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
} from "./cursor-reveal-adapters";
import { EditorChromeBody, EditorChromeInput, EditorChromePanel } from "./editor-chrome";
import { $isInlineMathNode } from "./nodes/inline-math-node";
import { $isFootnoteReferenceNode } from "./nodes/footnote-reference-node";
import { $isInlineImageNode } from "./nodes/inline-image-node";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import { $isReferenceNode } from "./nodes/reference-node";
import {
  COFLAT_NESTED_EDIT_TAG,
  COFLAT_REVEAL_COMMIT_TAG,
  COFLAT_REVEAL_UI_TAG,
} from "./update-tags";
import {
  createRevealOpenRequest,
  findRevealAdapter,
  OPEN_CURSOR_REVEAL_COMMAND,
  registerDecoratorClickRevealEntry,
  registerDecoratorKeyboardBoundaryRevealEntry,
  type CursorRevealOpenRequest,
} from "./cursor-reveal-controller";
import { renderRevealChromePreview } from "./reveal-chrome";
import { useRegisterEmbeddedFieldFlush } from "./embedded-field-flush-registry";
import { setCursorRevealActive } from "./cursor-reveal-state";
import {
  REVEAL_SOURCE_STYLE_PROPERTY,
  REVEAL_SOURCE_TEXT_STYLE,
} from "./reveal-source-style";

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
  if (editorMode === EDITOR_MODE.PARAGRAPH || presentation === REVEAL_PRESENTATION.INLINE) {
    return <InlineCursorReveal adapters={adapters} />;
  }
  return <FloatingCursorReveal adapters={adapters} />;
}

function useUserDrivenSelectionReveal(editor: LexicalEditor): MutableRefObject<boolean> {
  const enabledRef = useRef(false);

  useEffect(() => {
    const markUserSelectionIntent = (event: Event) => {
      const root = editor.getRootElement();
      const target = event.target instanceof Node ? event.target : null;
      const targetElement = target instanceof Element ? target : target?.parentElement ?? null;
      if (!root || !target || !root.contains(target) || targetElement?.closest("[contenteditable='true']") !== root) {
        return;
      }
      enabledRef.current = true;
    };

    document.addEventListener("pointerdown", markUserSelectionIntent, true);
    document.addEventListener("keydown", markUserSelectionIntent, true);
    return () => {
      document.removeEventListener("pointerdown", markUserSelectionIntent, true);
      document.removeEventListener("keydown", markUserSelectionIntent, true);
    };
  }, [editor]);

  return enabledRef;
}

function canOpenUserDrivenReveal(
  adapter: RevealAdapter,
  userSelectionRevealRef: MutableRefObject<boolean>,
): boolean {
  if (adapter.id !== "paragraph") {
    return true;
  }
  if (!userSelectionRevealRef.current) {
    return false;
  }
  userSelectionRevealRef.current = false;
  return true;
}

function usePointerSelectionReveal(
  editor: LexicalEditor,
  adapters: readonly RevealAdapter[],
  userSelectionRevealRef: MutableRefObject<boolean>,
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
            return;
          }
          const pick = pickRevealSubject(selection, adapters);
          if (!pick) {
            return;
          }
          if (!canOpenUserDrivenReveal(pick.adapter, userSelectionRevealRef)) {
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

    document.addEventListener("pointerup", handlePointerUp, true);
    return () => {
      document.removeEventListener("pointerup", handlePointerUp, true);
    };
  }, [adapters, editor, userSelectionRevealRef]);
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
  const userSelectionRevealRef = useUserDrivenSelectionReveal(editor);
  // Key we last revealed (or committed to). Prevents the floating editor
  // from reopening on the same node right after it closes, since Lexical's
  // post-commit selection still points at the replacement node.
  const lastRevealedKeyRef = useRef<NodeKey | null>(null);

  useEffect(() => {
    setState(null);
    setDraft("");
    lastRevealedKeyRef.current = null;
  }, [adapters]);

  const openFloatingRequest = useCallback((request: CursorRevealOpenRequest) => {
    const adapter = findRevealAdapter(adapters, request.adapterId);
    if (!adapter || request.nodeKey === lastRevealedKeyRef.current) {
      return;
    }
    const dom = editor.getElementByKey(request.nodeKey);
    if (!dom) {
      return;
    }
    lastRevealedKeyRef.current = request.nodeKey;
    setDraft(request.source);
    setState({
      adapter,
      anchor: dom,
      caretOffset: request.caretOffset,
      nodeKey: request.nodeKey,
    });
  }, [adapters, editor]);

  useEffect(
    () => registerDecoratorClickRevealEntry(editor, adapters, openFloatingRequest),
    [adapters, editor, openFloatingRequest],
  );
  useEffect(
    () => registerDecoratorKeyboardBoundaryRevealEntry(editor, adapters),
    [adapters, editor],
  );

  useLayoutEffect(() => {
    return editor.registerCommand(
      OPEN_CURSOR_REVEAL_COMMAND,
      (request) => {
        openFloatingRequest(request);
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, openFloatingRequest]);

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
        if (!canOpenUserDrivenReveal(pick.adapter, userSelectionRevealRef)) {
          return false;
        }
        editor.dispatchCommand(
          OPEN_CURSOR_REVEAL_COMMAND,
          createRevealOpenRequest(
            pick.subject,
            pick.adapter,
            pick.subject.caretOffset ?? pick.subject.source.length,
          ),
        );
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, adapters, userSelectionRevealRef]);

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
    if (current.adapter.id === "raw-block") {
      editor.update(() => {
        const node = $getNodeByKey(current.nodeKey);
        if (!$isRawBlockNode(node)) {
          return;
        }
        node.setRaw(nextRaw);
        lastRevealedKeyRef.current = node.getKey();
      }, { discrete: true, tag: COFLAT_NESTED_EDIT_TAG });
      return;
    }
    if (current.adapter.id === "paragraph") {
      setState(null);
      setDraft("");
      return;
    }
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
  readonly caretOffset: number;
  readonly source: string;
  readonly sourceFormat: number;
  readonly selectionState: "opening" | "active";
}

interface InlineRevealCommitResult {
  readonly replacement: LexicalNode | null;
  readonly sourceChanged: boolean;
}

interface InlineRevealChromeState {
  readonly plainKey: NodeKey;
  readonly adapter: RevealAdapter;
  readonly source: string;
}

function InlineCursorReveal({ adapters }: { adapters: readonly RevealAdapter[] }) {
  const [editor] = useLexicalComposerContext();
  const [chromeState, setChromeState] = useState<InlineRevealChromeState | null>(null);
  const userSelectionRevealRef = useUserDrivenSelectionReveal(editor);
  usePointerSelectionReveal(editor, adapters, userSelectionRevealRef);
  // Key of the in-flight plain-text reveal node. When the caret moves off
  // this key, we reparse it via the same adapter that opened it.
  const activeRef = useRef<InlineRevealHandle | null>(null);
  const lastArrowDirectionRef = useRef<"left" | "right" | null>(null);
  const skipOpeningArrowUntilRef = useRef(0);

  const selectAfterRevealCommit = useCallback((replacement: LexicalNode | null) => {
    const direction = lastArrowDirectionRef.current;
    if (!direction || !replacement) {
      return;
    }
    const sibling = direction === "right"
      ? replacement.getNextSibling()
      : replacement.getPreviousSibling();
    if (!$isTextNode(sibling)) {
      return;
    }
    if (direction === "right") {
      sibling.select(0, 0);
      return;
    }
    const size = sibling.getTextContentSize();
    sibling.select(size, size);
  }, []);

  const openInlineRequest = useCallback((request: CursorRevealOpenRequest) => {
    const adapter = findRevealAdapter(adapters, request.adapterId);
    if (!adapter) {
      return;
    }
    skipOpeningArrowUntilRef.current = request.entry === "keyboard-boundary"
      ? Date.now() + 100
      : 0;
    openInlineReveal(request, adapter, activeRef, setChromeState);
    scheduleOpeningRevealSelectionSync(editor, activeRef);
    setCursorRevealActive(editor, activeRef.current !== null);
  }, [adapters, editor]);

  useEffect(
    () => registerDecoratorClickRevealEntry(editor, adapters, openInlineRequest),
    [adapters, editor, openInlineRequest],
  );
  useEffect(
    () => registerDecoratorKeyboardBoundaryRevealEntry(editor, adapters),
    [adapters, editor],
  );

  useLayoutEffect(() => {
    return editor.registerCommand(
      OPEN_CURSOR_REVEAL_COMMAND,
      (request) => {
        openInlineRequest(request);
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, openInlineRequest]);

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
          const active = activeRef.current;
          const anchorKey = anchorTextKey(sel);
          const live = $getNodeByKey(active.plainKey);
          const domInsideReveal = $isTextNode(live)
            && domSelectionInsideRevealText(live.getTextContent());
          if (anchorKey && anchorKey === active.plainKey) {
            activeRef.current = domInsideReveal
              ? { ...active, selectionState: "active" }
              : active;
            return false;
          }
          if (domInsideReveal) {
            activeRef.current = { ...active, selectionState: "active" };
            return false;
          }
          // Opening a decorator reveal is a two-step transition: replace the
          // decorator with a TextNode, then let Lexical publish the selection
          // inside that TextNode. If a browser selectionchange races in from
          // the pre-swap state, restore the requested source caret instead of
          // treating an outside selection as a successful open.
          if (restoreOpeningRevealSelection(active, live)) {
            return false;
          }
          // Caret moved off the reveal. Commit the previous source, then
          // evaluate the current selection in the same transition so moving
          // directly from one formatted token to another does not require a
          // second selection event.
          $addUpdateTag(COFLAT_NESTED_EDIT_TAG);
          const commit = $commitInlineReveal(active);
          activeRef.current = null;
          setChromeState(null);
          setCursorRevealActive(editor, false);
          if (!commit.sourceChanged) {
            return false;
          }
          const nextSelection = $getSelection();
          if (!nextSelection) {
            return false;
          }
          const nextPick = pickRevealSubject(nextSelection, adapters);
          if (!nextPick) {
            return false;
          }
          const preferredOffset = "anchor" in nextSelection
            ? (nextSelection.anchor as { offset: number }).offset
            : 0;
          editor.dispatchCommand(
            OPEN_CURSOR_REVEAL_COMMAND,
            createRevealOpenRequest(nextPick.subject, nextPick.adapter, preferredOffset),
          );
          return false;
        }

        const pick = pickRevealSubject(sel, adapters);
        if (!pick) {
          return false;
        }
        if (!canOpenUserDrivenReveal(pick.adapter, userSelectionRevealRef)) {
          return false;
        }
        const preferredOffset = "anchor" in sel ? (sel.anchor as { offset: number }).offset : 0;
        editor.dispatchCommand(
          OPEN_CURSOR_REVEAL_COMMAND,
          createRevealOpenRequest(pick.subject, pick.adapter, preferredOffset),
        );
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, adapters, userSelectionRevealRef]);

  useEffect(() => {
    const handleArrow = (
      event: KeyboardEvent | null,
      direction: "left" | "right",
    ): boolean => {
      const active = activeRef.current;
      if (!active) {
        return false;
      }
      if (shouldSkipOpeningArrow(active, skipOpeningArrowUntilRef)) {
        return false;
      }
      lastArrowDirectionRef.current = direction;

      let handled = false;
      const live = $getNodeByKey(active.plainKey);
      const selection = $getSelection();
      if (!$isTextNode(live) || !$isRangeSelection(selection) || !selection.isCollapsed()) {
        return false;
      }
      if (selection.anchor.getNode().getKey() !== active.plainKey) {
        return false;
      }

      const offset = selection.anchor.offset;
      const size = live.getTextContentSize();
      const nextOffset = direction === "right" ? offset + 1 : offset - 1;
      if (nextOffset >= 0 && nextOffset <= size) {
        $addUpdateTag(COFLAT_REVEAL_UI_TAG);
        selectRevealText(live, nextOffset);
        activeRef.current = { ...active, selectionState: "active" };
        handled = true;
      } else {
        const commit = $commitInlineReveal(active);
        selectAfterRevealCommit(commit.replacement);
        activeRef.current = null;
        setChromeState(null);
        setCursorRevealActive(editor, false);
        handled = true;
      }

      if (!handled) {
        return false;
      }
      event?.preventDefault();
      event?.stopPropagation();
      return true;
    };

    const unregisterLeft = editor.registerCommand(
      KEY_ARROW_LEFT_COMMAND,
      (event) => handleArrow(event, "left"),
      COMMAND_PRIORITY_CRITICAL,
    );
    const unregisterRight = editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      (event) => handleArrow(event, "right"),
      COMMAND_PRIORITY_CRITICAL,
    );
    return () => {
      unregisterLeft();
      unregisterRight();
    };
  }, [editor, selectAfterRevealCommit]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const active = activeRef.current;
      if (
        !active
        || shouldSkipOpeningArrow(active, skipOpeningArrowUntilRef)
        || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
      ) {
        return;
      }

      const direction = event.key === "ArrowRight" ? "right" : "left";
      lastArrowDirectionRef.current = direction;
      let handled = false;

      editor.update(() => {
        const live = $getNodeByKey(active.plainKey);
        const selection = $getSelection();
        if (!$isTextNode(live)) {
          return;
        }
        const lexicalOffset = $isRangeSelection(selection)
          && selection.isCollapsed()
          && selection.anchor.getNode().getKey() === active.plainKey
          ? selection.anchor.offset
          : null;
        const domOffset = getDomSelectionOffsetInsideRevealText(live.getTextContent());
        const offset = lexicalOffset ?? (
          domOffset === null ? null : Math.min(domOffset, live.getTextContentSize())
        );
        if (offset === null) {
          return;
        }

        const size = live.getTextContentSize();
        const nextOffset = direction === "right" ? offset + 1 : offset - 1;
        if (nextOffset >= 0 && nextOffset <= size) {
          $addUpdateTag(COFLAT_REVEAL_UI_TAG);
          selectRevealText(live, nextOffset);
          activeRef.current = { ...active, selectionState: "active" };
          handled = true;
          return;
        }

        const commit = $commitInlineReveal(active);
        selectAfterRevealCommit(commit.replacement);
        activeRef.current = null;
        setChromeState(null);
        setCursorRevealActive(editor, false);
        handled = true;
      }, { discrete: true });

      if (!handled) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [editor, selectAfterRevealCommit]);

  useEffect(() => {
    const onSelectionChange = () => {
      const active = activeRef.current;
      if (!active) {
        return;
      }

      queueMicrotask(() => {
        const current = activeRef.current;
        if (!current || current.plainKey !== active.plainKey) {
          return;
        }

        editor.update(() => {
          const latest = activeRef.current;
          if (!latest || latest.plainKey !== active.plainKey) {
            return;
          }
          const live = $getNodeByKey(latest.plainKey);
          const selection = $getSelection();
          const domInsideReveal = $isTextNode(live)
            && domSelectionInsideRevealText(live.getTextContent());
          if (anchorTextKey(selection) === latest.plainKey) {
            activeRef.current = domInsideReveal
              ? { ...latest, selectionState: "active" }
              : latest;
            return;
          }
          if (domInsideReveal) {
            activeRef.current = { ...latest, selectionState: "active" };
            return;
          }
          if (restoreOpeningRevealSelection(latest, live)) {
            return;
          }

          $commitInlineReveal(latest);
          activeRef.current = null;
          setChromeState(null);
          setCursorRevealActive(editor, false);
        }, { discrete: true });
      });
    };

    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [editor]);

  useRegisterEmbeddedFieldFlush(() => {
    const active = activeRef.current;
    if (!active) {
      return;
    }
    editor.update(() => {
      $commitInlineReveal(active);
      setCursorRevealActive(editor, false);
    }, { discrete: true });
    activeRef.current = null;
    setChromeState(null);
  }, true);

  useEffect(() => () => {
    setCursorRevealActive(editor, false);
  }, [editor]);

  useEffect(() => {
    const plainKey = chromeState?.plainKey ?? null;
    if (!plainKey) {
      return;
    }

    return editor.registerUpdateListener(({ editorState }) => {
      let nextSource: string | null = null;
      editorState.read(() => {
        const live = $getNodeByKey(plainKey);
        nextSource = $isTextNode(live) ? live.getTextContent() : null;
      });
      setChromeState((current) => {
        if (current?.plainKey !== plainKey) {
          return current;
        }
        if (nextSource === null) {
          return null;
        }
        return current.source === nextSource
          ? current
          : { ...current, source: nextSource };
      });
    });
  }, [chromeState?.plainKey, editor]);

  return (
    <InlineRevealChrome
      editor={editor}
      onClose={() => setChromeState(null)}
      state={chromeState}
    />
  );
}

function InlineRevealChrome({
  editor,
  onClose,
  state,
}: {
  readonly editor: LexicalEditor;
  readonly onClose: () => void;
  readonly state: InlineRevealChromeState | null;
}) {
  const anchor = useLexicalElementByKey(editor, state?.plainKey ?? null);

  if (!state) {
    return null;
  }

  const preview = state.adapter.getChromePreview?.(state.source) ?? null;
  if (!preview || !anchor) {
    return null;
  }

  return renderRevealChromePreview(preview, {
    anchor,
    onAnchorLost: onClose,
    source: state.source,
  });
}

function useLexicalElementByKey(
  editor: LexicalEditor,
  key: NodeKey | null,
): HTMLElement | null {
  const [element, setElement] = useState<HTMLElement | null>(() => (
    key ? editor.getElementByKey(key) : null
  ));

  useEffect(() => {
    const resolve = () => {
      setElement(key ? editor.getElementByKey(key) : null);
    };
    resolve();
    return editor.registerUpdateListener(resolve);
  }, [editor, key]);

  return element;
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

function domSelectionInsideRevealText(text: string): boolean {
  return getDomSelectionOffsetInsideRevealText(text) !== null;
}

function getDomSelectionOffsetInsideRevealText(text: string): number | null {
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
  } catch {
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

function shouldSkipOpeningArrow(
  active: InlineRevealHandle,
  skipOpeningArrowUntilRef: { current: number },
): boolean {
  if (active.selectionState !== "opening" || Date.now() > skipOpeningArrowUntilRef.current) {
    skipOpeningArrowUntilRef.current = 0;
    return false;
  }
  skipOpeningArrowUntilRef.current = 0;
  return true;
}

function scheduleOpeningRevealSelectionSync(
  editor: LexicalEditor,
  activeRef: { current: InlineRevealHandle | null },
): void {
  const active = activeRef.current;
  if (!active || active.selectionState !== "opening") {
    return;
  }
  queueMicrotask(() => {
    editor.update(() => {
      const latest = activeRef.current;
      if (!latest || latest.plainKey !== active.plainKey) {
        return;
      }
      const live = $getNodeByKey(latest.plainKey);
      restoreOpeningRevealSelection(latest, live);
    }, { discrete: true });
  });
}

function restoreOpeningRevealSelection(
  active: InlineRevealHandle,
  live: LexicalNode | null | undefined,
): boolean {
  if (active.selectionState !== "opening" || !$isTextNode(live)) {
    return false;
  }
  $addUpdateTag(COFLAT_REVEAL_UI_TAG);
  $setSelection(null);
  selectRevealText(live, active.caretOffset);
  return true;
}

function selectRevealText(node: ReturnType<typeof $createTextNode>, offset: number): void {
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
 * Replace the subject node with a plain-text node containing its
 * markdown source, then position the caret inside. Records the key +
 * adapter via `activeRef` while still inside Lexical's command/update
 * context.
 */
function openInlineReveal(
  request: CursorRevealOpenRequest,
  adapter: RevealAdapter,
  activeRef: { current: InlineRevealHandle | null },
  setChromeState: (state: InlineRevealChromeState | null) => void,
): void {
  const live = $getNodeByKey(request.nodeKey);
  if (!live) {
    return;
  }
  const selectionState: InlineRevealHandle["selectionState"] = $isDecoratorNode(live)
    ? "opening"
    : "active";
  const sourceFormat = getSourceBackedFormat(live);
  const plain = $createTextNode(request.source);
  $addUpdateTag(COFLAT_REVEAL_UI_TAG);
  // Source reveals must stay visually distinct and must not merge with
  // neighboring prose TextNodes, otherwise we lose the key used to commit.
  plain.setStyle(REVEAL_SOURCE_TEXT_STYLE);
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
  const caretOffset = Math.max(0, Math.min(request.caretOffset, plain.getTextContentSize()));
  selectRevealText(plain, caretOffset);
  const plainKey = plain.getKey();
  activeRef.current = {
    adapter,
    caretOffset,
    plainKey,
    selectionState,
    source: request.source,
    sourceFormat,
  };
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

function $commitInlineReveal(handle: InlineRevealHandle): InlineRevealCommitResult {
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
