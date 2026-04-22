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
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  SELECTION_CHANGE_COMMAND,
  TextNode,
} from "lexical";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  PARAGRAPH_REVEAL_ADAPTERS,
  pickRevealSubject,
  REVEAL_ADAPTERS,
  type RevealAdapter,
} from "./cursor-reveal-adapters";
import {
  type CursorRevealOpenRequest,
  createRevealOpenRequest,
  findRevealAdapter,
  OPEN_CURSOR_REVEAL_COMMAND,
} from "./cursor-reveal-controller";
import {
  domSelectionInsideRevealText,
  getDomSelectionOffsetInsideRevealText,
  registerDecoratorClickRevealEntry,
  registerDecoratorKeyboardBoundaryRevealEntry,
  useDocumentKeyDownCapture,
  useDocumentSelectionChange,
  usePointerSelectionReveal,
  useUserDrivenSelectionReveal,
} from "./cursor-reveal-dom-bridge";
import {
  FloatingRevealPresentation,
  type FloatingRevealPresentationState,
} from "./cursor-reveal-floating-presentation";
import {
  InlineRevealChrome,
  type InlineRevealChromeState,
} from "./cursor-reveal-inline-presentation";
import {
  activateCursorReveal,
  beginCursorRevealClose,
  beginCursorRevealCommit,
  type CursorRevealMachineState,
  clearClosedCursorReveal,
  clearCursorRevealUserIntent,
  consumeCursorRevealUserIntent,
  createCursorRevealIdle,
  finishCursorRevealClose,
  getCursorRevealSession,
  isCursorRevealOpening,
  markCursorRevealUserIntent,
  openCursorReveal,
  shouldSuppressCursorRevealOpen,
} from "./cursor-reveal-machine";
import { setCursorRevealActive } from "./cursor-reveal-state";
import { useRegisterEmbeddedFieldFlush } from "./embedded-field-flush-registry";
import { $isFootnoteReferenceNode } from "./nodes/footnote-reference-node";
import { $isInlineImageNode } from "./nodes/inline-image-node";
import { $isInlineMathNode } from "./nodes/inline-math-node";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import { $isReferenceNode } from "./nodes/reference-node";
import {
  REVEAL_MODE,
  REVEAL_PRESENTATION,
  type RevealMode,
  type RevealPresentation,
} from "./reveal-mode";
import {
  REVEAL_SOURCE_TEXT_STYLE,
} from "./reveal-source-style";
import {
  COFLAT_NESTED_EDIT_TAG,
  COFLAT_REVEAL_COMMIT_TAG,
  COFLAT_REVEAL_UI_TAG,
} from "./update-tags";

// Re-exports kept so existing unit tests can continue importing the
// pure markdown helpers from this module.
export { unwrapSource, wrapWithSpecs } from "./cursor-reveal-adapters";

export function CursorRevealPlugin({
  editorMode,
  presentation,
}: {
  editorMode: RevealMode;
  presentation: RevealPresentation;
}) {
  // Mode picks the *scope* (which subtree the cursor surfaces); presentation
  // picks *where* the editable surface lives. PARAGRAPH mode swaps the
  // per-element adapters for a single paragraph adapter so the whole block
  // opens as one source surface instead of just the inline token under the
  // caret. SOURCE mode never reaches this plugin (it mounts PlainTextPlugin).
  const adapters = editorMode === REVEAL_MODE.PARAGRAPH
    ? PARAGRAPH_REVEAL_ADAPTERS
    : REVEAL_ADAPTERS;
  if (editorMode === REVEAL_MODE.PARAGRAPH || presentation === REVEAL_PRESENTATION.INLINE) {
    return <InlineCursorReveal adapters={adapters} />;
  }
  return <FloatingCursorReveal adapters={adapters} />;
}

interface CursorRevealLifecycleRef<Session> {
  current: CursorRevealMachineState<Session>;
}

function beginRevealCommit<Session>(
  lifecycleRef: CursorRevealLifecycleRef<Session>,
): void {
  lifecycleRef.current = beginCursorRevealCommit(lifecycleRef.current);
}

function finishRevealClose<Session>(
  lifecycleRef: CursorRevealLifecycleRef<Session>,
  lastClosedKey: NodeKey | null = null,
): void {
  lifecycleRef.current = finishCursorRevealClose(
    beginCursorRevealClose(lifecycleRef.current, lastClosedKey),
  );
}

// ─── Floating presentation ──────────────────────────────────────────────

function FloatingCursorReveal({ adapters }: { adapters: readonly RevealAdapter[] }) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<FloatingRevealPresentationState | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lifecycleRef = useRef<CursorRevealMachineState<FloatingRevealPresentationState>>(
    createCursorRevealIdle(),
  );
  const markUserRevealIntent = useCallback(() => {
    lifecycleRef.current = markCursorRevealUserIntent(lifecycleRef.current);
  }, []);
  useUserDrivenSelectionReveal(editor, markUserRevealIntent);

  const canOpenSelectionReveal = useCallback((adapter: RevealAdapter) => {
    const result = consumeCursorRevealUserIntent(
      lifecycleRef.current,
      adapter.id === "paragraph",
    );
    lifecycleRef.current = result.state;
    return result.allowed;
  }, []);
  useEffect(() => {
    setState(null);
    setDraft("");
    lifecycleRef.current = createCursorRevealIdle();
  }, [adapters]);

  const openFloatingRequest = useCallback((request: CursorRevealOpenRequest) => {
    const adapter = findRevealAdapter(adapters, request.adapterId);
    if (!adapter || shouldSuppressCursorRevealOpen(lifecycleRef.current, request.nodeKey)) {
      return;
    }
    const dom = editor.getElementByKey(request.nodeKey);
    if (!dom) {
      return;
    }
    const nextState = {
      adapter,
      anchor: dom,
      caretOffset: request.caretOffset,
      nodeKey: request.nodeKey,
    };
    lifecycleRef.current = openCursorReveal(nextState, "editing");
    setDraft(request.source);
    setState(nextState);
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
          lifecycleRef.current = clearCursorRevealUserIntent(
            clearClosedCursorReveal(lifecycleRef.current),
          );
          return false;
        }
        if (!canOpenSelectionReveal(pick.adapter)) {
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
  }, [editor, adapters, canOpenSelectionReveal]);

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

  const commitDraft = (current: FloatingRevealPresentationState, nextRaw: string) => {
    if (current.adapter.id === "raw-block") {
      editor.update(() => {
        const node = $getNodeByKey(current.nodeKey);
        if (!$isRawBlockNode(node)) {
          return;
        }
        beginRevealCommit(lifecycleRef);
        node.setRaw(nextRaw);
        finishRevealClose(lifecycleRef, node.getKey());
      }, { discrete: true, tag: COFLAT_NESTED_EDIT_TAG });
      return;
    }
    if (current.adapter.id === "paragraph") {
      finishRevealClose(lifecycleRef, current.nodeKey);
      setState(null);
      setDraft("");
      return;
    }
    editor.update(() => {
      const node = $getNodeByKey(current.nodeKey);
      if (!node) {
        return;
      }
      beginRevealCommit(lifecycleRef);
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
      finishRevealClose(lifecycleRef, replacement.getKey());
    }, { discrete: true, tag: COFLAT_NESTED_EDIT_TAG });
  };

  if (!state) {
    return null;
  }

  return (
    <FloatingRevealPresentation
      draft={draft}
      inputRef={inputRef}
      onCancel={() => {
        finishRevealClose(lifecycleRef, state.nodeKey);
        setState(null);
      }}
      onCommit={() => {
        commitDraft(state, draft);
        setState(null);
      }}
      onDraftChange={setDraft}
      state={state}
    />
  );
}

// ─── Inline (Typora-style) presentation ─────────────────────────────────

interface InlineRevealSession {
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

function InlineCursorReveal({ adapters }: { adapters: readonly RevealAdapter[] }) {
  const [editor] = useLexicalComposerContext();
  const [chromeState, setChromeState] = useState<InlineRevealChromeState | null>(null);
  const [activePlainKey, setActivePlainKey] = useState<NodeKey | null>(null);
  const activeRef = useRef<CursorRevealMachineState<InlineRevealSession>>(
    createCursorRevealIdle(),
  );
  const lastArrowDirectionRef = useRef<"left" | "right" | null>(null);
  const markUserRevealIntent = useCallback(() => {
    activeRef.current = markCursorRevealUserIntent(activeRef.current);
  }, []);
  useUserDrivenSelectionReveal(editor, markUserRevealIntent);

  const canOpenSelectionReveal = useCallback((adapter: RevealAdapter) => {
    const result = consumeCursorRevealUserIntent(
      activeRef.current,
      adapter.id === "paragraph",
    );
    activeRef.current = result.state;
    return result.allowed;
  }, []);
  const clearUserRevealIntent = useCallback(() => {
    activeRef.current = clearCursorRevealUserIntent(activeRef.current);
  }, []);
  usePointerSelectionReveal(editor, adapters, canOpenSelectionReveal, clearUserRevealIntent);

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
    openInlineReveal(request, adapter, activeRef, setChromeState);
    scheduleOpeningRevealSelectionSync(editor, activeRef);
    const active = getCursorRevealSession(activeRef.current);
    setActivePlainKey(active?.plainKey ?? null);
    setCursorRevealActive(editor, active !== null);
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
        const active = getCursorRevealSession(activeRef.current);
        if (active) {
          const anchorKey = anchorTextKey(sel);
          const live = $getNodeByKey(active.plainKey);
          const domInsideReveal = $isTextNode(live)
            && domSelectionInsideRevealText(live.getTextContent());
          if (anchorKey && anchorKey === active.plainKey) {
            if (domInsideReveal) {
              activeRef.current = activateCursorReveal(activeRef.current);
            }
            return false;
          }
          if (domInsideReveal) {
            activeRef.current = activateCursorReveal(activeRef.current);
            return false;
          }
          // Opening a decorator reveal is a two-step transition: replace the
          // decorator with a TextNode, then let Lexical publish the selection
          // inside that TextNode. If a browser selectionchange races in from
          // the pre-swap state, restore the requested source caret instead of
          // treating an outside selection as a successful open.
          if (restoreOpeningRevealSelection(activeRef.current, live)) {
            return false;
          }
          // Caret moved off the reveal. Commit the previous source, then
          // evaluate the current selection in the same transition so moving
          // directly from one formatted token to another does not require a
          // second selection event.
          $addUpdateTag(COFLAT_NESTED_EDIT_TAG);
          const commit = commitAndCloseInlineReveal(activeRef, active);
          setChromeState(null);
          setActivePlainKey(null);
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
          activeRef.current = clearCursorRevealUserIntent(activeRef.current);
          setActivePlainKey(null);
          return false;
        }
        if (!canOpenSelectionReveal(pick.adapter)) {
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
  }, [editor, adapters, canOpenSelectionReveal]);

  useEffect(() => {
    const handleArrow = (
      event: KeyboardEvent | null,
      direction: "left" | "right",
    ): boolean => {
      const active = getCursorRevealSession(activeRef.current);
      if (!active) {
        return false;
      }
      if (shouldSkipOpeningArrow(activeRef.current)) {
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
        activeRef.current = activateCursorReveal(activeRef.current);
        handled = true;
      } else {
        const commit = commitAndCloseInlineReveal(activeRef, active);
        selectAfterRevealCommit(commit.replacement);
        setChromeState(null);
        setActivePlainKey(null);
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

  const handleDocumentKeyDown = useCallback((event: KeyboardEvent) => {
    const active = getCursorRevealSession(activeRef.current);
    if (
      !active
      || shouldSkipOpeningArrow(activeRef.current)
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
        activeRef.current = activateCursorReveal(activeRef.current);
        handled = true;
        return;
      }

      const commit = commitAndCloseInlineReveal(activeRef, active);
      selectAfterRevealCommit(commit.replacement);
      setChromeState(null);
      setActivePlainKey(null);
      setCursorRevealActive(editor, false);
      handled = true;
    }, { discrete: true });

    if (!handled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }, [editor, selectAfterRevealCommit]);

  useDocumentKeyDownCapture(activePlainKey !== null, handleDocumentKeyDown);

  const handleDocumentSelectionChange = useCallback(() => {
    const active = getCursorRevealSession(activeRef.current);
    if (!active) {
      return;
    }

    queueMicrotask(() => {
      const current = getCursorRevealSession(activeRef.current);
      if (!current || current.plainKey !== active.plainKey) {
        return;
      }

      editor.update(() => {
        const latest = getCursorRevealSession(activeRef.current);
        if (!latest || latest.plainKey !== active.plainKey) {
          return;
        }
        const live = $getNodeByKey(latest.plainKey);
        const selection = $getSelection();
        const domInsideReveal = $isTextNode(live)
          && domSelectionInsideRevealText(live.getTextContent());
        if (anchorTextKey(selection) === latest.plainKey) {
          if (domInsideReveal) {
            activeRef.current = activateCursorReveal(activeRef.current);
          }
          return;
        }
        if (domInsideReveal) {
          activeRef.current = activateCursorReveal(activeRef.current);
          return;
        }
        if (restoreOpeningRevealSelection(activeRef.current, live)) {
          return;
        }

        commitAndCloseInlineReveal(activeRef, latest);
        setChromeState(null);
        setActivePlainKey(null);
        setCursorRevealActive(editor, false);
      }, { discrete: true });
    });
  }, [editor]);

  useDocumentSelectionChange(activePlainKey !== null, handleDocumentSelectionChange);

  useRegisterEmbeddedFieldFlush(() => {
    const active = getCursorRevealSession(activeRef.current);
    if (!active) {
      return;
    }
    editor.update(() => {
      commitAndCloseInlineReveal(activeRef, active);
      setCursorRevealActive(editor, false);
    }, { discrete: true });
    setChromeState(null);
    setActivePlainKey(null);
  }, true);

  useEffect(() => () => {
    activeRef.current = createCursorRevealIdle();
    setActivePlainKey(null);
    setCursorRevealActive(editor, false);
  }, [editor]);

  useEffect(() => {
    const plainKey = chromeState?.plainKey ?? null;
    if (!plainKey) {
      return;
    }

    return editor.registerMutationListener(TextNode, (mutations) => {
      if (!mutations.has(plainKey)) {
        return;
      }
      let nextSource: string | null = null;
      editor.getEditorState().read(() => {
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
      onClose={() => {
        activeRef.current = createCursorRevealIdle();
        setChromeState(null);
        setActivePlainKey(null);
        setCursorRevealActive(editor, false);
      }}
      state={chromeState}
    />
  );
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

function shouldSkipOpeningArrow(
  state: CursorRevealMachineState<InlineRevealSession>,
): boolean {
  return isCursorRevealOpening(state)
    && Date.now() <= state.suppressArrowUntil;
}

function scheduleOpeningRevealSelectionSync(
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

function restoreOpeningRevealSelection(
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

function commitAndCloseInlineReveal(
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
