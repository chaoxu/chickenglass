/**
 * embedded-field-editor — Rich nested editor for inline/block fields inside
 * decorator nodes (captions, titles, table cells).
 *
 * Uses LexicalRichMarkdownEditor with activation lifecycle (always-on or
 * focus-activated). For source-text editing of structure metadata fields
 * (openers, include paths), see StructureSourceEditor instead — it wraps
 * the plain LexicalMarkdownEditor with draft/commit/revert semantics.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import {
  type EmbeddedFieldFamily,
  getEmbeddedFieldFamilySpec,
} from "../lexical-next";
import {
  BLOCK_KEYBOARD_ENTRY_ATTRIBUTE,
  type BlockKeyboardEntryPriority,
} from "./block-keyboard-entry";
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
  readonly onTextChange?: (text: string) => void;
  readonly pendingFocusId?: string;
}

export function EmbeddedFieldEditor({
  activation = "always",
  className,
  doc,
  editable,
  family,
  keyboardEntryPriority,
  namespace,
  onTextChange,
  pendingFocusId,
}: EmbeddedFieldEditorProps) {
  const context = useLexicalRenderContext();
  const surfaceEditable = useLexicalSurfaceEditable();
  const [nestedRoot, setNestedRoot] = useState<HTMLElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
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

  const activate = useCallback((focusRequest: FocusRequest = "end") => {
    if (!canActivateRef.current) {
      return;
    }
    requestedFocusRef.current = focusRequest;
    if (focusRequest === "pointer") {
      flushSync(() => {
        setActive(true);
      });
      return;
    }
    setActive(true);
  }, []);

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
      {...(keyboardEntryPriority
        ? { [BLOCK_KEYBOARD_ENTRY_ATTRIBUTE]: keyboardEntryPriority }
        : {})}
      onBlurCapture={canActivate
        ? (event) => {
            if (requestedFocusRef.current) {
              return;
            }
            const nextFocused = event.relatedTarget;
            if (nextFocused instanceof Node && shellRef.current?.contains(nextFocused)) {
              return;
            }
            setActive(false);
          }
        : undefined}
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
        doc={doc}
        editable={effectiveEditable}
        editorClassName={className}
        focusOwnerRole="embedded-field"
        layoutMode={spec.fieldKind === "inline" ? "inline" : "block"}
        namespace={namespace}
        onRootElementChange={setNestedRoot}
        onTextChange={onTextChange}
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
