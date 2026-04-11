import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import {
  type EmbeddedFieldFamily,
  getEmbeddedFieldFamilySpec,
} from "../lexical-next";
import { useLexicalSurfaceEditable } from "./editability-context";
import { COFLAT_FOCUS_EDGE_EVENT } from "./focus-edge-plugin";
import { useLexicalRenderContext } from "./render-context";
import { LexicalRichMarkdownEditor } from "./rich-markdown-editor";

type ActivationMode = "always" | "focus";
type FocusRequest = "end" | "pointer";

export interface EmbeddedFieldEditorProps {
  readonly activation?: ActivationMode;
  readonly className: string;
  readonly doc: string;
  readonly editable?: boolean;
  readonly family: EmbeddedFieldFamily;
  readonly namespace: string;
  readonly onTextChange?: (text: string) => void;
}

export function EmbeddedFieldEditor({
  activation = "always",
  className,
  doc,
  editable,
  family,
  namespace,
  onTextChange,
}: EmbeddedFieldEditorProps) {
  const context = useLexicalRenderContext();
  const surfaceEditable = useLexicalSurfaceEditable();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const requestedFocusRef = useRef<FocusRequest | null>(null);
  const spec = getEmbeddedFieldFamilySpec(family);
  const canActivate = activation === "focus" && (editable ?? surfaceEditable);
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
    if (!canActivate) {
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
  }, [canActivate]);

  const effectiveEditable = activation === "focus"
    ? Boolean((editable ?? surfaceEditable) && active)
    : Boolean(editable ?? surfaceEditable);

  useEffect(() => {
    const requestedFocus = requestedFocusRef.current;
    if (!requestedFocus || !active) {
      return;
    }

    let cancelled = false;
    let attemptsRemaining = 6;

    const focusEditableRoot = () => {
      if (cancelled || requestedFocusRef.current !== requestedFocus) {
        return;
      }

      const editableRoot = shellRef.current?.querySelector<HTMLElement>("[contenteditable='true']");
      if (editableRoot) {
        if (requestedFocus === "end") {
          editableRoot.dispatchEvent(new CustomEvent(COFLAT_FOCUS_EDGE_EVENT, {
            detail: { edge: "end" },
          }));
        }
        editableRoot.focus({ preventScroll: true });
      }
      if (shellRef.current?.contains(document.activeElement)) {
        requestedFocusRef.current = null;
        return;
      }

      attemptsRemaining -= 1;
      if (attemptsRemaining <= 0) {
        requestedFocusRef.current = null;
        return;
      }

      requestAnimationFrame(focusEditableRoot);
    };

    focusEditableRoot();
    return () => {
      cancelled = true;
    };
  }, [active]);

  return (
    <div
      className={canActivate ? "cf-embedded-field-shell cf-embedded-field-shell--focus" : "cf-embedded-field-shell"}
      onBlurCapture={canActivate
        ? (event) => {
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
        layoutMode={spec.fieldKind === "inline" ? "inline" : "block"}
        namespace={namespace}
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
