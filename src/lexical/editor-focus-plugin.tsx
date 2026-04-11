/**
 * editor-focus-plugin — Central focus arbiter for Lexical editor surfaces.
 *
 * ## Focus ownership model
 *
 * Each Lexical editor surface has an EditorFocusPlugin that tracks whether
 * it currently owns focus. Ownership is expressed as a FocusOwner value
 * from `src/state/editor-focus.ts` and flows through Lexical commands:
 *
 * - `REQUEST_SURFACE_FOCUS_COMMAND` — Programmatic focus request. Used by
 *   EditorHandlePlugin and markdown-editor to transfer focus to a surface
 *   at a specific edge (start/end/current).
 *
 * - `FOCUS_COMMAND` / `BLUR_COMMAND` — Native focus/blur events. The plugin
 *   updates the current FocusOwner accordingly.
 *
 * ## What goes through this system
 *
 * Focus transitions between Lexical editor surfaces (main rich editor,
 * embedded field editors, source editors) go through dispatchSurfaceFocusRequest
 * or scheduleRegisteredSurfaceFocus.
 *
 * ## What does NOT go through this system
 *
 * Non-Lexical DOM elements (native <input> in InlineMathSourcePlugin,
 * LinkSourcePlugin, reference-renderer) manage their own .focus() calls.
 * These are leaf-level UI elements within a Lexical decorator, not
 * competing editor surfaces. Similarly, block-keyboard-access-plugin
 * focuses focusable decorator containers directly.
 */
import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  FOCUS_COMMAND,
  createCommand,
  mergeRegister,
  type LexicalEditor,
} from "lexical";

import {
  clearFocusOwnerIfMatch,
  FOCUS_NONE,
  setFocusOwner,
  type FocusOwner,
  type SurfaceFocusOwner,
} from "../state/editor-focus";

export type FocusRequestEdge = "current" | "end" | "start";

export interface FocusRequest {
  readonly edge?: FocusRequestEdge;
  readonly owner: SurfaceFocusOwner;
}

export const REQUEST_SURFACE_FOCUS_COMMAND = createCommand<FocusRequest>(
  "COFLAT_REQUEST_SURFACE_FOCUS_COMMAND",
);

interface RegisteredFocusTarget {
  readonly requestFocus: (edge?: FocusRequestEdge) => boolean;
}

const registeredFocusTargets = new WeakMap<HTMLElement, RegisteredFocusTarget>();

function isSurfaceRootFocused(rootElement: HTMLElement): boolean {
  const activeElement = rootElement.ownerDocument.activeElement;
  return activeElement instanceof Node
    && (activeElement === rootElement || rootElement.contains(activeElement));
}

function focusRootElementFallback(
  rootElement: HTMLElement,
  edge: FocusRequestEdge,
): boolean {
  rootElement.focus();

  if (edge === "start" || edge === "end") {
    const selection = rootElement.ownerDocument.getSelection();
    if (selection) {
      const range = rootElement.ownerDocument.createRange();
      range.selectNodeContents(rootElement);
      range.collapse(edge === "start");
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  const target = registeredFocusTargets.get(rootElement);
  if (target) {
    target.requestFocus(edge);
  }

  return isSurfaceRootFocused(rootElement);
}

function focusEditorSurface(
  editor: LexicalEditor,
  edge: FocusRequestEdge,
): void {
  if (edge === "start" || edge === "end") {
    editor.update(() => {
      const root = $getRoot();
      if (edge === "start") {
        root.selectStart();
        return;
      }
      root.selectEnd();
    }, { discrete: true });
  }

  editor.focus(
    undefined,
    edge === "start"
      ? { defaultSelection: "rootStart" }
      : edge === "end"
        ? { defaultSelection: "rootEnd" }
        : undefined,
  );
}

export function dispatchSurfaceFocusRequest(
  editor: LexicalEditor,
  request: FocusRequest,
): boolean {
  return editor.dispatchCommand(REQUEST_SURFACE_FOCUS_COMMAND, request);
}

export function requestRegisteredSurfaceFocus(
  rootElement: HTMLElement,
  edge: FocusRequestEdge = "current",
): boolean {
  const target = registeredFocusTargets.get(rootElement);
  return target ? target.requestFocus(edge) : false;
}

type SurfaceFocusTarget = HTMLElement | (() => HTMLElement | null);

function resolveSurfaceFocusTarget(
  target: SurfaceFocusTarget,
): HTMLElement | null {
  return typeof target === "function" ? target() : target;
}

export function scheduleRegisteredSurfaceFocus(
  target: SurfaceFocusTarget,
  options: {
    readonly edge?: FocusRequestEdge;
    readonly onFailure?: () => void;
    readonly maxAttempts?: number;
    readonly onSuccess?: () => void;
  } = {},
): () => void {
  const edge = options.edge ?? "current";
  let attemptsRemaining = options.maxAttempts ?? 4;
  let cancelled = false;
  let fallbackUsed = false;

  const requestFocus = () => {
    if (cancelled) {
      return;
    }
    const rootElement = resolveSurfaceFocusTarget(target);
    if (!rootElement || !rootElement.isConnected) {
      if (attemptsRemaining > 0) {
        attemptsRemaining -= 1;
        requestAnimationFrame(requestFocus);
        return;
      }
      options.onFailure?.();
      return;
    }
    if (isSurfaceRootFocused(rootElement)) {
      options.onSuccess?.();
      return;
    }
    if (attemptsRemaining > 0) {
      attemptsRemaining -= 1;
      requestRegisteredSurfaceFocus(rootElement, edge);
      requestAnimationFrame(requestFocus);
      return;
    }
    if (!fallbackUsed) {
      fallbackUsed = true;
      focusRootElementFallback(rootElement, edge);
      requestAnimationFrame(requestFocus);
      return;
    }

    options.onFailure?.();
  };

  requestFocus();
  return () => {
    cancelled = true;
  };
}

export function EditorFocusPlugin({
  onFocusOwnerChange,
  owner,
}: {
  readonly onFocusOwnerChange?: (owner: FocusOwner) => void;
  readonly owner: SurfaceFocusOwner;
}) {
  const [editor] = useLexicalComposerContext();
  const currentOwnerRef = useRef<FocusOwner>(FOCUS_NONE);

  useEffect(() => {
    const commitOwner = (nextOwner: FocusOwner) => {
      if (nextOwner === currentOwnerRef.current) {
        return;
      }
      currentOwnerRef.current = nextOwner;
      onFocusOwnerChange?.(nextOwner);
    };

    return mergeRegister(
      editor.registerCommand(
        REQUEST_SURFACE_FOCUS_COMMAND,
        (request) => {
          commitOwner(setFocusOwner(currentOwnerRef.current, request.owner));
          focusEditorSurface(editor, request.edge ?? "current");
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          commitOwner(setFocusOwner(currentOwnerRef.current, owner));
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          commitOwner(clearFocusOwnerIfMatch(currentOwnerRef.current, owner));
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerRootListener((rootElement, previousRootElement) => {
        if (previousRootElement) {
          registeredFocusTargets.delete(previousRootElement);
        }

        if (!rootElement) {
          return;
        }

        registeredFocusTargets.set(rootElement, {
          requestFocus: (edge = "current") => {
            rootElement.focus();
            dispatchSurfaceFocusRequest(editor, { edge, owner });
            return isSurfaceRootFocused(rootElement);
          },
        });

        return () => {
          registeredFocusTargets.delete(rootElement);
        };
      }),
    );
  }, [editor, onFocusOwnerChange, owner]);

  return null;
}
