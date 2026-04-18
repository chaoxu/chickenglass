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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import katex from "katex";
import {
  $addUpdateTag,
  $createParagraphNode,
  $createTextNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isTextNode,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
  createCommand,
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
  pickRevealSubjectFromNode,
  type RevealBoundaryDirection,
  type RevealAdapter,
  type RevealSubject,
} from "./cursor-reveal-adapters";
import { EditorChromeBody, EditorChromeInput, EditorChromePanel } from "./editor-chrome";
import { stripInlineMathDelimiters } from "./inline-math-source";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import { useLexicalRenderContext } from "./render-context";
import { buildKatexOptions } from "../lib/katex-options";
import { preventKatexMouseDown } from "./renderers/shared";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";

// Re-exports kept so existing unit tests can continue importing the
// pure markdown helpers from this module.
export { wrapWithSpecs, unwrapSource } from "./cursor-reveal-adapters";

interface CursorRevealOpenRequest {
  readonly adapterId: string;
  readonly caretOffset: number;
  readonly nodeKey: NodeKey;
  readonly source: string;
}

const OPEN_CURSOR_REVEAL_COMMAND = createCommand<CursorRevealOpenRequest>(
  "OPEN_CURSOR_REVEAL_COMMAND",
);

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
  onOpen: (request: CursorRevealOpenRequest) => void,
): void {
  useEffect(() => {
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
        );
        event.preventDefault();
        event.stopPropagation();
        onOpen(request);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onOpen, adapters]);
}

function useDecoratorKeyboardBoundaryEntry(
  editor: LexicalEditor,
  adapters: readonly RevealAdapter[],
): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = directionFromArrowKey(event.key);
      if (
        direction === null
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
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
  }, [adapters, editor]);
}

function directionFromArrowKey(key: string): RevealBoundaryDirection | null {
  if (key === "ArrowRight") {
    return "forward";
  }
  if (key === "ArrowLeft") {
    return "backward";
  }
  return null;
}

function findRevealRequestFromDomBoundary(
  editor: LexicalEditor,
  adapters: readonly RevealAdapter[],
  direction: RevealBoundaryDirection,
): CursorRevealOpenRequest | null {
  const root = editor.getRootElement();
  const decorator = root ? findAdjacentDecoratorFromDomSelection(root, direction) : null;
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
    );
  });
  return request;
}

function findAdjacentDecoratorFromDomSelection(
  root: HTMLElement,
  direction: RevealBoundaryDirection,
): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed || !selection.anchorNode || !root.contains(selection.anchorNode)) {
    return null;
  }

  const candidate = adjacentDomBoundaryNode(
    selection.anchorNode,
    selection.anchorOffset,
    direction,
  );
  return decoratorElementFromCandidate(candidate);
}

function adjacentDomBoundaryNode(
  anchorNode: Node,
  anchorOffset: number,
  direction: RevealBoundaryDirection,
): Node | null {
  if (anchorNode.nodeType === Node.TEXT_NODE) {
    const text = anchorNode.textContent ?? "";
    const boundaryNode = lexicalTextBoundaryNode(anchorNode);
    if (direction === "forward") {
      return anchorOffset === text.length ? nextMeaningfulSibling(boundaryNode) : null;
    }
    return anchorOffset === 0 ? previousMeaningfulSibling(boundaryNode) : null;
  }

  if (!(anchorNode instanceof Element)) {
    return null;
  }

  if (direction === "forward") {
    return anchorOffset < anchorNode.childNodes.length
      ? firstMeaningfulNode(anchorNode.childNodes[anchorOffset] ?? null, direction)
      : nextMeaningfulSibling(anchorNode);
  }
  return anchorOffset > 0
    ? firstMeaningfulNode(anchorNode.childNodes[anchorOffset - 1] ?? null, direction)
    : previousMeaningfulSibling(anchorNode);
}

function lexicalTextBoundaryNode(node: Node): Node {
  const parent = node.parentElement;
  return parent?.hasAttribute("data-lexical-text") ? parent : node;
}

function decoratorElementFromCandidate(node: Node | null): HTMLElement | null {
  if (!(node instanceof Element)) {
    return null;
  }
  const decorator = node.matches("[data-lexical-decorator='true']")
    ? node
    : node.closest("[data-lexical-decorator='true']");
  return decorator instanceof HTMLElement ? decorator : null;
}

function isIgnorableDomBoundaryNode(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").length === 0;
}

function firstMeaningfulNode(
  node: Node | null,
  direction: RevealBoundaryDirection,
): Node | null {
  let current = node;
  while (current && isIgnorableDomBoundaryNode(current)) {
    current = direction === "forward"
      ? current.nextSibling
      : current.previousSibling;
  }
  return current;
}

function nextMeaningfulSibling(node: Node): Node | null {
  return firstMeaningfulNode(node.nextSibling, "forward");
}

function previousMeaningfulSibling(node: Node): Node | null {
  return firstMeaningfulNode(node.previousSibling, "backward");
}

function createRevealOpenRequest(
  subject: RevealSubject,
  adapter: RevealAdapter,
  preferredOffset: number,
): CursorRevealOpenRequest {
  return {
    adapterId: adapter.id,
    caretOffset: computeCaretOffset(subject, preferredOffset),
    nodeKey: subject.node.getKey(),
    source: subject.source,
  };
}

function findRevealAdapter(
  adapters: readonly RevealAdapter[],
  adapterId: string,
): RevealAdapter | null {
  return adapters.find((adapter) => adapter.id === adapterId) ?? null;
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

  useDecoratorClickEntry(editor, adapters, openFloatingRequest);
  useDecoratorKeyboardBoundaryEntry(editor, adapters);

  useEffect(() => {
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
  }, [editor, adapters]);

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
  readonly selectionState: "opening" | "active";
}

interface InlineRevealChromeState {
  readonly plainKey: NodeKey;
  readonly adapter: RevealAdapter;
  readonly source: string;
}

function InlineCursorReveal({ adapters }: { adapters: readonly RevealAdapter[] }) {
  const [editor] = useLexicalComposerContext();
  const [chromeState, setChromeState] = useState<InlineRevealChromeState | null>(null);
  // Key of the in-flight plain-text reveal node. When the caret moves off
  // this key, we reparse it via the same adapter that opened it.
  const activeRef = useRef<InlineRevealHandle | null>(null);

  const openInlineRequest = useCallback((request: CursorRevealOpenRequest) => {
    const adapter = findRevealAdapter(adapters, request.adapterId);
    if (!adapter) {
      return;
    }
    openInlineReveal(request, adapter, activeRef, setChromeState);
  }, [adapters]);

  useDecoratorClickEntry(editor, adapters, openInlineRequest);
  useDecoratorKeyboardBoundaryEntry(editor, adapters);

  useEffect(() => {
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
          if (anchorKey && anchorKey === active.plainKey) {
            activeRef.current = { ...active, selectionState: "active" };
            return false;
          }
          // Opening a decorator reveal is a two-step transition: replace the
          // decorator with a TextNode, then let Lexical publish the selection
          // inside that TextNode. Selection-change events from the pre-swap
          // state are not exits; only commit after the reveal has reached
          // the active state at least once.
          if (active.selectionState === "opening") {
            return false;
          }
          // Caret moved off the reveal. Commit the previous source, then
          // evaluate the current selection in the same transition so moving
          // directly from one formatted token to another does not require a
          // second selection event.
          $addUpdateTag(COFLAT_NESTED_EDIT_TAG);
          $commitInlineReveal(active);
          activeRef.current = null;
          setChromeState(null);
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
        const preferredOffset = "anchor" in sel ? (sel.anchor as { offset: number }).offset : 0;
        editor.dispatchCommand(
          OPEN_CURSOR_REVEAL_COMMAND,
          createRevealOpenRequest(pick.subject, pick.adapter, preferredOffset),
        );
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, adapters]);

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

  if (preview.kind === "inline-math") {
    return (
      <InlineMathRevealPreview
        anchor={anchor}
        onAnchorLost={onClose}
        source={state.source}
      />
    );
  }

  return null;
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

function InlineMathRevealPreview({
  anchor,
  onAnchorLost,
  source,
}: {
  readonly anchor: HTMLElement;
  readonly onAnchorLost: () => void;
  readonly source: string;
}) {
  const { config } = useLexicalRenderContext();
  const body = useMemo(() => stripInlineMathDelimiters(source.trim()), [source]);
  const html = useMemo(
    () => katex.renderToString(body, buildKatexOptions(false, config.math)),
    [body, config.math],
  );

  return (
    <SurfaceFloatingPortal
      anchor={anchor}
      className="cf-lexical-inline-reveal-preview-portal"
      offsetPx={4}
      onAnchorLost={onAnchorLost}
      placement="bottom-start"
      zIndex={62}
    >
      <EditorChromePanel className="cf-lexical-inline-reveal-preview-shell">
        <EditorChromeBody className="cf-lexical-inline-reveal-preview-surface">
          <span
            aria-hidden="true"
            className="cf-lexical-inline-math-preview"
            dangerouslySetInnerHTML={{ __html: html }}
            onMouseDown={preventKatexMouseDown}
          />
        </EditorChromeBody>
      </EditorChromePanel>
    </SurfaceFloatingPortal>
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
  const plain = $createTextNode(request.source);
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
  plain.select(request.caretOffset, request.caretOffset);
  const plainKey = plain.getKey();
  activeRef.current = { adapter, plainKey, selectionState };
  setChromeState(
    adapter.getChromePreview?.(request.source)
      ? { adapter, plainKey, source: request.source }
      : null,
  );
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

function $commitInlineReveal(handle: InlineRevealHandle): void {
  const live = $getNodeByKey(handle.plainKey);
  if (!$isTextNode(live)) {
    return;
  }
  handle.adapter.reparse(live, live.getTextContent());
}
