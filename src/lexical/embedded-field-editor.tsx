/**
 * embedded-field-editor — Rich nested editor for inline/block fields inside
 * decorator nodes (captions, titles, table cells).
 *
 * Uses LexicalRichMarkdownEditor with activation lifecycle (always-on or
 * focus-activated). For source-text editing of structure metadata fields
 * (openers, include paths), see StructureSourceEditor instead — it wraps
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
} from "../lexical-next";
import type { MarkdownEditorHandle, MarkdownEditorSelection } from "./markdown-editor-types";
import {
  blockKeyboardEntryProps,
  type BlockKeyboardEntryPriority,
} from "./block-keyboard-entry";
import { useRegisterEmbeddedFieldFlush } from "./embedded-field-flush-registry";
import { useLexicalSurfaceEditable } from "./editability-context";
import { scheduleRegisteredSurfaceFocus, type FocusRequestEdge } from "./editor-focus-plugin";
import { consumePendingSurfaceFocus } from "./pending-surface-focus";
import { useLexicalRenderContext } from "./render-context";
import { LexicalRichMarkdownEditor } from "./rich-markdown-editor";

type ActivationMode = "always" | "focus";
type FocusRequest = FocusRequestEdge | "pointer";

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
  const [draftDoc, setDraftDoc] = useState(doc);
  const publishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preserveFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preserveFocusAfterPublishRef = useRef(false);
  const lastPointerDownOutsideRef = useRef(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const nestedEditorHandleRef = useRef<MarkdownEditorHandle | null>(null);
  const pendingDraftRef = useRef<string | null>(null);
  const requestedFocusRef = useRef<FocusRequest | null>(null);
  const spec = getEmbeddedFieldFamilySpec(family);
  const canActivate = activation === "focus" && (editable ?? surfaceEditable);
  const canActivateRef = useRef(canActivate);
  canActivateRef.current = canActivate;
  const [active, setActive] = useState(activation === "always");

  useEffect(() => {
    if (activation === "always") {
      setActive(true);
      return;
    }
    if (!(editable ?? surfaceEditable)) {
      setActive(false);
    }
  }, [activation, editable, surfaceEditable]);

  useEffect(() => {
    if (pendingDraftRef.current !== null) {
      return;
    }
    setDraftDoc(doc);
  }, [doc]);

  const clearPublishTimer = useCallback(() => {
    if (publishTimerRef.current === null) {
      return;
    }
    clearTimeout(publishTimerRef.current);
    publishTimerRef.current = null;
  }, []);

  const clearPreserveFocusTimer = useCallback(() => {
    if (preserveFocusTimerRef.current === null) {
      return;
    }
    clearTimeout(preserveFocusTimerRef.current);
    preserveFocusTimerRef.current = null;
  }, []);

  const publishDraft = useCallback((options?: {
    readonly clearPending?: boolean;
    readonly preserveFocus?: boolean;
  }) => {
    const pendingDraft = pendingDraftRef.current;
    const currentDoc = normalizeEmbeddedFieldDoc(doc, spec);
    if (pendingDraft !== null && pendingDraft !== currentDoc) {
      if (options?.preserveFocus) {
        preserveFocusAfterPublishRef.current = true;
        clearPreserveFocusTimer();
        preserveFocusTimerRef.current = setTimeout(() => {
          preserveFocusAfterPublishRef.current = false;
          preserveFocusTimerRef.current = null;
        }, 250);
      }
      onTextChange?.(pendingDraft);
    }
    if (options?.clearPending) {
      pendingDraftRef.current = null;
    }
  }, [clearPreserveFocusTimer, doc, onTextChange, spec]);

  const commitDraft = useCallback(() => {
    nestedEditorHandleRef.current?.flushPendingEdits();
    clearPublishTimer();
    publishDraft({ clearPending: true });
  }, [clearPublishTimer, publishDraft]);

  useRegisterEmbeddedFieldFlush(commitDraft, Boolean(onTextChange));

  useEffect(() => () => {
    clearPublishTimer();
    clearPreserveFocusTimer();
  }, [clearPreserveFocusTimer, clearPublishTimer]);

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
    pendingDraftRef.current = null;
    setDraftDoc(doc);
    requestedFocusRef.current = focusRequest;
    if (focusRequest === "pointer") {
      flushSync(() => {
        setActive(true);
      });
      return;
    }
    setActive(true);
  }, [doc]);

  const handleTextChange = useCallback((nextDoc: string) => {
    const normalizedDoc = normalizeEmbeddedFieldDoc(nextDoc, spec);
    pendingDraftRef.current = normalizedDoc;
    setDraftDoc(normalizedDoc);
    clearPublishTimer();
    publishTimerRef.current = setTimeout(() => {
      publishTimerRef.current = null;
      publishDraft({ preserveFocus: true });
    }, 150);
  }, [clearPublishTimer, publishDraft, spec]);

  const handleSelectionChange = useCallback((selection: MarkdownEditorSelection) => {
    onSelectionChange?.(selection, pendingDraftRef.current ?? draftDoc);
  }, [draftDoc, onSelectionChange]);

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
  }, [active, nestedRoot]);

  useEffect(() => {
    if (!pendingFocusId) {
      return;
    }

    const edge = consumePendingSurfaceFocus(pendingFocusId);
    if (!edge || typeof edge === "object") {
      return;
    }

    requestedFocusRef.current = edge;
    if (activation === "focus") {
      setActive(true);
    }
  }, [activation, pendingFocusId]);

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
        ? () => {
            activate("pointer");
          }
        : undefined}
      ref={shellRef}
      tabIndex={canActivate && !active ? 0 : undefined}
    >
      <LexicalRichMarkdownEditor
        doc={pendingDraftRef.current === null ? doc : draftDoc}
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
        repairBlankClickSelection={spec.fieldKind !== "inline"}
        requireUserEditFlag={false}
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
