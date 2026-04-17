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
  $createNodeSelection,
  $getNodeByKey,
  $getSelection,
  $isDecoratorNode,
  $isNodeSelection,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  createCommand,
  mergeRegister,
  type LexicalEditor,
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

interface ActivateStructureEditRequest {
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

function useStructureEditContext(): StructureEditContextValue {
  const value = useContext(StructureEditContext);
  if (!value) {
    throw new Error("useStructureEditContext must be used within a StructureEditProvider");
  }
  return value;
}

function syncDecoratorNodeSelection(
  editor: LexicalEditor,
  blockKey: NodeKey,
): void {
  editor.update(() => {
    const node = $getNodeByKey(blockKey);
    if (!$isDecoratorNode(node)) {
      return;
    }

    // Always replace via $setSelection — mutating the existing NodeSelection
    // can fail with "Cannot assign to read only property 'dirty'" when the
    // pending state holds a clone whose mutation guard wasn't properly reset.
    const nextSelection = $createNodeSelection();
    nextSelection.add(blockKey);
    $setSelection(nextSelection);
  }, { discrete: true });
}

export function StructureEditProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<StructureEditState>(STRUCTURE_EDIT_IDLE);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
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

      setState((value) => deactivateStructureEditIfMatch(
        value,
        current.blockKey,
        current.surface,
      ));
    };

    return mergeRegister(
      // Lexical commits the prior NodeSelection as frozen, then
      // @lexical/rich-text's CLICK_COMMAND handler tries to mutate it via
      // selection.clear() — crashing dev mode with "Cannot assign to read
      // only property 'dirty'". Pre-empt that by replacing any node-selection
      // with a fresh, mutable instance before downstream handlers run.
      editor.registerCommand(
        CLICK_COMMAND,
        () => {
          const selection = $getSelection();
          if ($isNodeSelection(selection)) {
            const fresh = $createNodeSelection();
            for (const key of selection.getNodes().map((n) => n.getKey())) {
              fresh.add(key);
            }
            $setSelection(fresh);
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        ACTIVATE_STRUCTURE_EDIT_COMMAND,
        (request) => {
          syncDecoratorNodeSelection(editor, request.blockKey);
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

  // Selection is set inside ACTIVATE_STRUCTURE_EDIT_COMMAND via
  // syncDecoratorNodeSelection — don't double-set via useLexicalNodeSelection
  // here, which crashes when the selection state holds a frozen NodeSelection.
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
