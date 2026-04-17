import { memo, useCallback, useMemo, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import katex from "katex";
import type { NodeKey } from "lexical";

import { useLexicalSurfaceEditable } from "../editability-context";
import { useLexicalRenderContext } from "../render-context";
import { StructureSourceEditor } from "../structure-source-editor";
import { useStructureEditToggle } from "../structure-edit-plugin";
import { getPendingEmbeddedSurfaceFocusId } from "../pending-surface-focus";
import { parseStructuredDisplayMathRaw } from "../markdown/block-syntax";
import { readSourcePositionFromElement } from "../source-position-plugin";
import { SET_SOURCE_SELECTION_COMMAND } from "../source-selection-command";
import { buildKatexOptions } from "../../lib/katex-options";
import {
  preventKatexMouseDown,
  structureToggleProps,
  useLazyVisibility,
  useRawBlockUpdater,
} from "./shared";

export const DisplayMathBlockRenderer = memo(function DisplayMathBlockRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const { config, renderIndex } = useLexicalRenderContext();
  const [editor] = useLexicalComposerContext();
  const surfaceEditable = useLexicalSurfaceEditable();
  const parsed = useMemo(() => parseStructuredDisplayMathRaw(raw), [raw]);
  const updateRaw = useRawBlockUpdater(nodeKey);
  const sourceEdit = useStructureEditToggle(
    nodeKey,
    "display-math",
    "display-math-source",
  );
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const visible = useLazyVisibility(bodyRef);
  const equation = useMemo(
    () => visible
      ? katex.renderToString(parsed.body, buildKatexOptions(true, config.math))
      : null,
    [config.math, parsed.body, visible],
  );
  const label = parsed.id ? renderIndex.references.get(parsed.id)?.shortLabel : undefined;
  const rememberSourcePosition = useCallback((element: HTMLElement) => {
    const sourcePosition = readSourcePositionFromElement(element);
    if (sourcePosition === null) {
      return;
    }
    editor.dispatchCommand(SET_SOURCE_SELECTION_COMMAND, sourcePosition);
  }, [editor]);

  return (
    <div
      className={`cf-lexical-display-math${sourceEdit.active ? " is-editing" : ""}`}
    >
      {!sourceEdit.active ? (
        <>
          {equation === null ? (
            <div
              className="cf-lexical-display-math-body"
              data-coflat-display-math-pending=""
              onMouseDown={preventKatexMouseDown}
              ref={bodyRef}
              style={{ minHeight: "3em", minWidth: "8em" }}
              {...structureToggleProps(surfaceEditable, sourceEdit.activate, {
                onBeforeActivate: rememberSourcePosition,
              })}
            >
              {"\u00A0"}
            </div>
          ) : (
            <div
              className="cf-lexical-display-math-body"
              dangerouslySetInnerHTML={{ __html: equation }}
              onMouseDown={preventKatexMouseDown}
              ref={bodyRef}
              {...structureToggleProps(surfaceEditable, sourceEdit.activate, {
                onBeforeActivate: rememberSourcePosition,
              })}
            />
          )}
          {label ? (
            <div
              className="cf-lexical-display-math-label"
              {...structureToggleProps(surfaceEditable, sourceEdit.activate, {
                onBeforeActivate: rememberSourcePosition,
              })}
            >
              {label}
            </div>
          ) : null}
        </>
      ) : (
        <div className="cf-lexical-display-math-editor">
          <StructureSourceEditor
            className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-structure-source-editor cf-lexical-structure-source-editor--math"
            doc={raw}
            multiline
            namespace={`coflat-display-math-${nodeKey}`}
            onChange={updateRaw}
            onClose={sourceEdit.deactivate}
            pendingFocusId={getPendingEmbeddedSurfaceFocusId(editor.getKey(), nodeKey, "structure-source")}
          />
        </div>
      )}
    </div>
  );
});
