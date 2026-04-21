/**
 * embedded-field-editor — Rich nested editor for inline/block fields inside
 * decorator nodes (captions, titles, table cells).
 *
 * Uses LexicalRichMarkdownEditor with activation lifecycle (always-on or
 * focus-activated). For source-text editing of structure metadata fields
 * (openers and structure source fields), see StructureSourceEditor instead — it wraps
 * the plain LexicalMarkdownEditor with draft/commit/revert semantics.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
} from "react";
import { flushSync } from "react-dom";

import {
  type EmbeddedFieldFamily,
  getEmbeddedFieldFamilySpec,
} from "./runtime";
import type { MarkdownEditorHandle, MarkdownEditorSelection } from "./markdown-editor-types";
import {
  blockKeyboardEntryProps,
  type BlockKeyboardEntryPriority,
} from "./block-keyboard-entry";
import { readVisibleTextDomSelection } from "./dom-selection";
import { useEmbeddedFieldDraftController } from "./embedded-field-draft-controller";
import { useRegisterEmbeddedFieldFlush } from "./embedded-field-flush-registry";
import { useLexicalSurfaceEditable } from "./editability-context";
import { scheduleRegisteredSurfaceFocus, type FocusRequestEdge } from "./editor-focus-plugin";
import {
  consumePendingSurfaceFocus,
  subscribePendingSurfaceFocus,
} from "./pending-surface-focus";
import type { PendingSurfaceFocusRequest } from "./pending-surface-focus";
import { useLexicalRenderContext } from "./render-context";
import { LexicalRichMarkdownEditor } from "./rich-markdown-editor";

type ActivationMode = "always" | "focus";
type FocusRequest = FocusRequestEdge | "pointer" | Extract<PendingSurfaceFocusRequest, { readonly offset: number }>;

export interface EmbeddedFieldEditorProps {
  readonly activation?: ActivationMode;
  readonly className: string;
  readonly doc: string;
  readonly editable?: boolean;
  readonly family: EmbeddedFieldFamily;
  readonly keyboardEntryPriority?: BlockKeyboardEntryPriority;
  readonly namespace: string;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection, markdown: string) => void;
  readonly onTextChange?: (text: string) => void;
  readonly pendingFocusId?: string;
}

function normalizeEmbeddedFieldDoc(doc: string, spec: { readonly needsSingleLineLayout: boolean }): string {
  return spec.needsSingleLineLayout ? doc.replace(/\n+$/, "") : doc;
}

export function EmbeddedFieldEditor({
  activation = "always",
  className,
  doc,
  editable,
  family,
  keyboardEntryPriority,
  namespace,
  onSelectionChange,
  onTextChange,
  pendingFocusId,
}: EmbeddedFieldEditorProps) {
  const context = useLexicalRenderContext();
  const surfaceEditable = useLexicalSurfaceEditable();
  const [nestedRoot, setNestedRoot] = useState<HTMLElement | null>(null);
  // Raw-block parent updates can remount decorator content in large documents.
  // Keep the focused field pinned to its local draft while still publishing
  // idle edits, so app-level dirty state tracks focused titles/captions too.
  const preserveFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preserveFocusAfterPublishRef = useRef(false);
  const pendingPublishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPublishDocRef = useRef<string | null>(null);
  const lastPointerDownOutsideRef = useRef(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const nestedEditorHandleRef = useRef<MarkdownEditorHandle | null>(null);
  const requestedFocusRef = useRef<FocusRequest | null>(null);
  const spec = getEmbeddedFieldFamilySpec(family);
  const normalizeDraft = useCallback(
    (nextDoc: string) => normalizeEmbeddedFieldDoc(nextDoc, spec),
    [spec],
  );
  const draft = useEmbeddedFieldDraftController({
    normalize: normalizeDraft,
    onPublish: onTextChange,
    publishPolicy: "on-commit",
    value: doc,
  });
  const canActivate = activation === "focus" && (editable ?? surfaceEditable);
  const canActivateRef = useRef(canActivate);
  canActivateRef.current = canActivate;
  const [active, setActive] = useState(activation === "always");
  const [focusRequestVersion, setFocusRequestVersion] = useState(0);

  useEffect(() => {
    if (activation === "always") {
      setActive(true);
      return;
    }
    if (!(editable ?? surfaceEditable)) {
      setActive(false);
    }
  }, [activation, editable, surfaceEditable]);

  const clearPreserveFocusTimer = useCallback(() => {
    if (preserveFocusTimerRef.current === null) {
      return;
    }
    clearTimeout(preserveFocusTimerRef.current);
    preserveFocusTimerRef.current = null;
  }, []);

  const cancelScheduledPublish = useCallback(() => {
    if (pendingPublishTimerRef.current !== null) {
      clearTimeout(pendingPublishTimerRef.current);
      pendingPublishTimerRef.current = null;
    }
    pendingPublishDocRef.current = null;
  }, []);

  const scheduleParentPublish = useCallback((nextDoc: string) => {
    if (!onTextChange) {
      return;
    }
    pendingPublishDocRef.current = nextDoc;
    if (pendingPublishTimerRef.current !== null) {
      clearTimeout(pendingPublishTimerRef.current);
    }
    pendingPublishTimerRef.current = setTimeout(() => {
      pendingPublishTimerRef.current = null;
      const pendingDoc = pendingPublishDocRef.current;
      pendingPublishDocRef.current = null;
      if (pendingDoc !== null) {
        onTextChange(pendingDoc);
      }
    }, 120);
  }, [onTextChange]);

  const commitDraft = useCallback(() => {
    const focusedElement = document.activeElement;
    const shouldFlushNestedEditor =
      draft.pendingDraftRef.current !== null
      || Boolean(
        focusedElement instanceof Node
        && shellRef.current?.contains(focusedElement),
      );
    if (shouldFlushNestedEditor) {
      nestedEditorHandleRef.current?.flushPendingEdits();
    }
    cancelScheduledPublish();
    clearPreserveFocusTimer();
    preserveFocusAfterPublishRef.current = false;
    if (shouldFlushNestedEditor && onSelectionChange) {
      const nestedSelection = nestedEditorHandleRef.current?.getSelection();
      if (nestedSelection) {
        onSelectionChange(
          nestedSelection,
          nestedEditorHandleRef.current?.peekDoc()
            ?? draft.pendingDraftRef.current
            ?? draft.draft,
        );
      }
    }
    draft.commitDraft();
  }, [cancelScheduledPublish, clearPreserveFocusTimer, draft, onSelectionChange]);

  useRegisterEmbeddedFieldFlush(commitDraft, Boolean(onTextChange));

  useEffect(() => () => {
    clearPreserveFocusTimer();
    cancelScheduledPublish();
  }, [cancelScheduledPublish, clearPreserveFocusTimer]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const shell = shellRef.current;
      lastPointerDownOutsideRef.current = Boolean(
        shell
        && event.target instanceof Node
        && !shell.contains(event.target),
      );
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, []);

  const activate = useCallback((focusRequest: FocusRequest = "end") => {
    if (!canActivateRef.current) {
      return;
    }
    draft.resetDraft(doc, { clearPending: true });
    requestedFocusRef.current = focusRequest;
    setFocusRequestVersion((version) => version + 1);
    if (focusRequest === "pointer") {
      flushSync(() => {
        setActive(true);
      });
      return;
    }
    setActive(true);
  }, [doc, draft]);

  const readCurrentNestedMarkdown = useCallback(() =>
    nestedEditorHandleRef.current?.peekDoc() ?? draft.pendingDraftRef.current ?? draft.draft,
  [draft]);

  const publishVisibleSelection = useCallback(() => {
    if (spec.fieldKind !== "inline") {
      return;
    }
    const visibleSelection = readVisibleTextDomSelection(nestedRoot);
    if (!visibleSelection) {
      return;
    }
    onSelectionChange?.(visibleSelection, readCurrentNestedMarkdown());
  }, [nestedRoot, onSelectionChange, readCurrentNestedMarkdown]);

  const handleTextChange = useCallback((nextDoc: string) => {
    preserveFocusAfterPublishRef.current = true;
    clearPreserveFocusTimer();
    preserveFocusTimerRef.current = setTimeout(() => {
      preserveFocusAfterPublishRef.current = false;
      preserveFocusTimerRef.current = null;
    }, 250);
    const nextDraft = draft.updateDraft(nextDoc);
    if (nextDraft === normalizeDraft(doc)) {
      cancelScheduledPublish();
    } else {
      scheduleParentPublish(nextDraft);
    }
    const publishNextVisibleSelection = () => {
      if (spec.fieldKind !== "inline") {
        return;
      }
      const visibleSelection = readVisibleTextDomSelection(nestedRoot);
      if (visibleSelection) {
        onSelectionChange?.(visibleSelection, nextDraft);
      }
    };
    queueMicrotask(publishNextVisibleSelection);
    requestAnimationFrame(publishNextVisibleSelection);
    if (spec.fieldKind === "inline") {
      setTimeout(publishNextVisibleSelection, 0);
      setTimeout(publishNextVisibleSelection, 100);
    }
  }, [
    cancelScheduledPublish,
    clearPreserveFocusTimer,
    doc,
    draft,
    nestedRoot,
    normalizeDraft,
    onSelectionChange,
    scheduleParentPublish,
    spec.fieldKind,
  ]);

  const handleSelectionChange = useCallback((selection: MarkdownEditorSelection) => {
    const visibleSelection = spec.fieldKind === "inline"
      ? readVisibleTextDomSelection(nestedRoot)
      : null;
    onSelectionChange?.(
      visibleSelection ?? selection,
      readCurrentNestedMarkdown(),
    );
  }, [nestedRoot, onSelectionChange, readCurrentNestedMarkdown, spec.fieldKind]);

  useEffect(() => {
    if (!onSelectionChange || !nestedRoot) {
      return;
    }
    requestAnimationFrame(publishVisibleSelection);
    const handleSelectionChangeEvent = () => {
      queueMicrotask(publishVisibleSelection);
    };
    nestedRoot.ownerDocument.addEventListener("selectionchange", handleSelectionChangeEvent);
    return () => {
      nestedRoot.ownerDocument.removeEventListener("selectionchange", handleSelectionChangeEvent);
    };
  }, [nestedRoot, onSelectionChange, publishVisibleSelection]);

  useEffect(() => {
    if (!onSelectionChange || spec.fieldKind !== "inline") {
      return;
    }
    requestAnimationFrame(publishVisibleSelection);
  }, [doc, onSelectionChange, publishVisibleSelection, spec.fieldKind]);

  const handleNestedEditorReady = useCallback((handle: MarkdownEditorHandle) => {
    nestedEditorHandleRef.current = handle;
  }, []);

  const handleFocusExit = useCallback((nextFocused: EventTarget | null) => {
    if (requestedFocusRef.current) {
      return;
    }
    if (nextFocused instanceof Node && shellRef.current?.contains(nextFocused)) {
      return;
    }
    const pointerDownOutside = lastPointerDownOutsideRef.current;
    lastPointerDownOutsideRef.current = false;
    if (preserveFocusAfterPublishRef.current && !pointerDownOutside && nextFocused === null) {
      scheduleRegisteredSurfaceFocus(() => nestedRoot, { edge: "current", maxAttempts: 6 });
      return;
    }
    preserveFocusAfterPublishRef.current = false;
    commitDraft();
    if (canActivate) {
      setActive(false);
    }
  }, [canActivate, commitDraft, nestedRoot]);

  const handleBlurCapture = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    handleFocusExit(event.relatedTarget);
  }, [handleFocusExit]);

  useEffect(() => {
    if (!onTextChange && !canActivate) {
      return;
    }
    const shell = shellRef.current;
    if (!shell) {
      return;
    }
    const handleFocusOut = (event: FocusEvent) => {
      handleFocusExit(event.relatedTarget);
    };
    shell.addEventListener("focusout", handleFocusOut);
    return () => {
      shell.removeEventListener("focusout", handleFocusOut);
    };
  }, [canActivate, handleFocusExit, onTextChange]);

  const effectiveEditable = activation === "focus"
    ? Boolean((editable ?? surfaceEditable) && active)
    : Boolean(editable ?? surfaceEditable);

  useLayoutEffect(() => {
    const requestedFocus = requestedFocusRef.current;
    if (!requestedFocus || !active || !nestedRoot) {
      return;
    }

    if (typeof requestedFocus === "object") {
      nestedEditorHandleRef.current?.setSelection(
        requestedFocus.offset,
        requestedFocus.offset,
        { skipScrollIntoView: true },
      );
      requestedFocusRef.current = null;
      return;
    }

    return scheduleRegisteredSurfaceFocus(nestedRoot, {
      edge: requestedFocus === "pointer" ? "current" : requestedFocus,
      maxAttempts: 6,
      onFailure: () => {
        requestedFocusRef.current = null;
        if (activation === "focus") {
          setActive(false);
        }
      },
      onSuccess: () => {
        requestedFocusRef.current = null;
      },
    });
  }, [active, focusRequestVersion, nestedRoot]);

  const requestFocus = useCallback((edge: PendingSurfaceFocusRequest) => {
    requestedFocusRef.current = edge;
    setFocusRequestVersion((version) => version + 1);
    if (activation === "focus") {
      setActive(true);
    }
  }, [activation]);

  useEffect(() => {
    if (!pendingFocusId) {
      return;
    }

    const edge = consumePendingSurfaceFocus(pendingFocusId);
    if (edge) {
      requestFocus(edge);
    }

    return subscribePendingSurfaceFocus(pendingFocusId, requestFocus);
  }, [pendingFocusId, requestFocus]);

  return (
    <div
      className={canActivate ? "cf-embedded-field-shell cf-embedded-field-shell--focus" : "cf-embedded-field-shell"}
      {...blockKeyboardEntryProps(keyboardEntryPriority)}
      onBlurCapture={onTextChange || canActivate ? handleBlurCapture : undefined}
      onFocus={canActivate && !active
        ? () => {
            activate();
          }
        : undefined}
      onKeyDown={canActivate && !active
        ? (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              activate();
            }
          }
        : undefined}
      onMouseDownCapture={canActivate && !active
        ? (event) => {
            // Activation remounts the nested editor; do not let the same
            // pointer sequence finish as a parent-editor click on stale DOM.
            event.preventDefault();
            event.stopPropagation();
            activate("pointer");
          }
        : undefined}
      ref={shellRef}
      tabIndex={canActivate && !active ? 0 : undefined}
    >
      <LexicalRichMarkdownEditor
        doc={draft.pendingDraftRef.current === null ? doc : draft.draft}
        editable={effectiveEditable}
        editorClassName={className}
        focusOwnerRole="embedded-field"
        layoutMode={spec.fieldKind === "inline" ? "inline" : "block"}
        namespace={namespace}
        onEditorReady={handleNestedEditorReady}
        onRootElementChange={setNestedRoot}
        onSelectionChange={handleSelectionChange}
        onTextChange={handleTextChange}
        preserveLocalHistory
        requireUserEditFlag={false}
        repairBlankClickSelection={spec.fieldKind !== "inline"}
        renderContextValue={context}
        showCodeBlockChrome={false}
        showHeadingChrome={false}
        showViewportTracking={false}
        singleLine={spec.needsSingleLineLayout}
        spellCheck={false}
        testId={null}
      />
    </div>
  );
}
