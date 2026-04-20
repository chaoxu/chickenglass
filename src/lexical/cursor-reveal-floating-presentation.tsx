import { type RefObject } from "react";
import type { NodeKey } from "lexical";

import { SurfaceFloatingPortal } from "../lexical-next";
import type { RevealAdapter } from "./cursor-reveal-adapters";
import { EditorChromeBody, EditorChromeInput, EditorChromePanel } from "./editor-chrome";

export interface FloatingRevealPresentationState {
  readonly nodeKey: NodeKey;
  readonly anchor: HTMLElement;
  readonly adapter: RevealAdapter;
  readonly caretOffset: number;
}

export function FloatingRevealPresentation({
  draft,
  inputRef,
  onCancel,
  onCommit,
  onDraftChange,
  state,
}: {
  readonly draft: string;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onCancel: () => void;
  readonly onCommit: () => void;
  readonly onDraftChange: (draft: string) => void;
  readonly state: FloatingRevealPresentationState;
}) {
  const widthCh = Math.max(3, draft.length + 1);

  return (
    <SurfaceFloatingPortal anchor={state.anchor} offsetPx={8}>
      <EditorChromePanel className="cf-lexical-floating-source-shell cf-lexical-inline-token-panel-shell">
        <EditorChromeBody className="cf-lexical-floating-source-surface cf-lexical-inline-token-panel-surface">
          <EditorChromeInput
            ref={inputRef}
            className="cf-lexical-inline-token-source cf-lexical-floating-source-editor cf-lexical-inline-token-panel-editor"
            onBlur={onCommit}
            onChange={(event) => onDraftChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onCommit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
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
