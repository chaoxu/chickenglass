import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNodeByKey,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  createCommand,
  mergeRegister,
  type NodeKey,
} from "lexical";

import {
  activateStructureEdit,
  deactivateStructureEdit,
  deactivateStructureEditIfMatch,
} from "../state/structure-edit-controller";
import {
  STRUCTURE_EDIT_IDLE,
  isStructureEditActive,
  isStructureEditMatch,
  type StructureBlockVariant,
  type StructureEditState,
  type StructureEditSurface,
} from "../state/structure-edit";

export interface ActivateStructureEditRequest {
  readonly blockKey: NodeKey;
  readonly surface: StructureEditSurface;
  readonly variant: StructureBlockVariant;
}

interface DeactivateStructureEditRequest {
  readonly blockKey?: NodeKey;
  readonly surface?: StructureEditSurface;
}

export const ACTIVATE_STRUCTURE_EDIT_COMMAND = createCommand<ActivateStructureEditRequest>(
  "COFLAT_ACTIVATE_STRUCTURE_EDIT_COMMAND",
);

export const DEACTIVATE_STRUCTURE_EDIT_COMMAND = createCommand<DeactivateStructureEditRequest>(
  "COFLAT_DEACTIVATE_STRUCTURE_EDIT_COMMAND",
);

interface StructureEditContextValue {
  readonly activate: (request: ActivateStructureEditRequest) => boolean;
  readonly deactivate: (request?: DeactivateStructureEditRequest) => boolean;
  readonly state: StructureEditState;
}

const StructureEditContext = createContext<StructureEditContextValue | null>(null);

function $releaseParentSelection(): void {
  $setSelection(null);
}

function useStructureEditContext(): StructureEditContextValue {
  const value = useContext(StructureEditContext);
  if (!value) {
    throw new Error("useStructureEditContext must be used within a StructureEditProvider");
  }
  return value;
}

export function StructureEditProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<StructureEditState>(STRUCTURE_EDIT_IDLE);
  const stateRef = useRef(state);
  const focusOutTimerRef = useRef<number | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const clearFocusOutTimer = () => {
      if (focusOutTimerRef.current === null) {
        return;
      }
      window.clearTimeout(focusOutTimerRef.current);
      focusOutTimerRef.current = null;
    };

    const deactivateIfFocusStayedOutside = (
      blockKey: NodeKey,
      surface: StructureEditSurface,
    ) => {
      focusOutTimerRef.current = null;
      const current = stateRef.current;
      if (
        current.status !== "editing"
        || current.blockKey !== blockKey
        || current.surface !== surface
      ) {
        return;
      }

      const blockElement = editor.getElementByKey(blockKey);
      if (!(blockElement instanceof HTMLElement)) {
        setState((value) => deactivateStructureEditIfMatch(value, blockKey, surface));
        return;
      }

      const activeElement = blockElement.ownerDocument.activeElement;
      if (activeElement instanceof Node && blockElement.contains(activeElement)) {
        return;
      }

      setState((value) => deactivateStructureEditIfMatch(value, blockKey, surface));
    };

    const handleRootFocusOut = (event: FocusEvent) => {
      const current = stateRef.current;
      if (!isStructureEditActive(current)) {
        return;
      }

      const blockElement = editor.getElementByKey(current.blockKey);
      if (!(blockElement instanceof HTMLElement)) {
        setState((value) => deactivateStructureEditIfMatch(
          value,
          current.blockKey,
          current.surface,
        ));
        return;
      }

      const nextFocused = event.relatedTarget;
      if (nextFocused instanceof Node && blockElement.contains(nextFocused)) {
        return;
      }

      clearFocusOutTimer();
      focusOutTimerRef.current = window.setTimeout(
        () => deactivateIfFocusStayedOutside(current.blockKey, current.surface),
        50,
      );
    };

    return mergeRegister(
      editor.registerCommand(
        ACTIVATE_STRUCTURE_EDIT_COMMAND,
        (request) => {
          // Once a structure surface opens, the nested editor owns focus and
          // caret state. Leaving a parent NodeSelection behind lets Lexical's
          // rich-text click handler mutate stale selection state on the next
          // click, so activation releases parent selection instead.
          $releaseParentSelection();
          setState((current) => activateStructureEdit(
            current,
            request.blockKey,
            request.variant,
            request.surface,
          ));
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        DEACTIVATE_STRUCTURE_EDIT_COMMAND,
        (request) => {
          clearFocusOutTimer();
          const current = stateRef.current;
          const shouldReleaseSelection = request?.blockKey && request.surface
            ? current.status === "editing"
              && current.blockKey === request.blockKey
              && current.surface === request.surface
            : current.status === "editing";
          if (shouldReleaseSelection) {
            $releaseParentSelection();
          }
          setState((current) => {
            if (request?.blockKey && request.surface) {
              return deactivateStructureEditIfMatch(
                current,
                request.blockKey,
                request.surface,
              );
            }
            return deactivateStructureEdit(current);
          });
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerUpdateListener(({ editorState }) => {
        const current = stateRef.current;
        if (!isStructureEditActive(current)) {
          return;
        }

        let nodeMissing = false;
        editorState.read(() => {
          nodeMissing = $getNodeByKey(current.blockKey) === null;
        });

        if (!nodeMissing) {
          return;
        }

        setState((value) => deactivateStructureEditIfMatch(
          value,
          current.blockKey,
          current.surface,
        ));
      }),
      editor.registerRootListener((rootElement, previousRootElement) => {
        previousRootElement?.removeEventListener("focusout", handleRootFocusOut, true);

        if (!rootElement) {
          return;
        }

        rootElement.addEventListener("focusout", handleRootFocusOut, true);
        return () => {
          rootElement.removeEventListener("focusout", handleRootFocusOut, true);
        };
      }),
      clearFocusOutTimer,
    );
  }, [editor]);

  const value = useMemo<StructureEditContextValue>(() => ({
    activate: (request) => editor.dispatchCommand(ACTIVATE_STRUCTURE_EDIT_COMMAND, request),
    deactivate: (request) => editor.dispatchCommand(
      DEACTIVATE_STRUCTURE_EDIT_COMMAND,
      request ?? {},
    ),
    state,
  }), [editor, state]);

  return (
    <StructureEditContext.Provider value={value}>
      {children}
    </StructureEditContext.Provider>
  );
}

export function useStructureEditToggle(
  blockKey: NodeKey,
  variant: StructureBlockVariant,
  surface: StructureEditSurface,
): {
  readonly active: boolean;
  readonly activate: () => void;
  readonly deactivate: () => void;
} {
  const context = useStructureEditContext();

  // Structure editing is represented by StructureEditState, not by keeping the
  // parent editor's decorator NodeSelection alive while the nested surface owns
  // focus.
  const activate = useCallback(() => {
    context.activate({ blockKey, surface, variant });
  }, [blockKey, context, surface, variant]);

  const deactivate = useCallback(() => {
    context.deactivate({ blockKey, surface });
  }, [blockKey, context, surface]);

  return {
    active: isStructureEditMatch(context.state, blockKey, variant, surface),
    activate,
    deactivate,
  };
}
