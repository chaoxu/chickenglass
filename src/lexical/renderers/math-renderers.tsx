import { useMemo } from "react";
import katex from "katex";
import type { NodeKey } from "lexical";

import { useLexicalSurfaceEditable } from "../editability-context";
import { useLexicalRenderContext } from "../render-context";
import { StructureSourceEditor } from "../structure-source-editor";
import { useStructureEditToggle } from "../structure-edit-plugin";
import { parseStructuredDisplayMathRaw } from "../markdown/block-syntax";
import { buildKatexOptions } from "../../lib/katex-options";
import { structureToggleProps, useRawBlockUpdater } from "./shared";

export function DisplayMathBlockRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const { config, renderIndex } = useLexicalRenderContext();
  const surfaceEditable = useLexicalSurfaceEditable();
  const parsed = useMemo(() => parseStructuredDisplayMathRaw(raw), [raw]);
  const updateRaw = useRawBlockUpdater(nodeKey);
  const sourceEdit = useStructureEditToggle(
    nodeKey,
    "display-math",
    "display-math-source",
  );
  const equation = useMemo(
    () => katex.renderToString(parsed.body, buildKatexOptions(true, config.math)),
    [config.math, parsed.body],
  );
  const label = parsed.id ? renderIndex.references.get(parsed.id)?.shortLabel : undefined;

  return (
    <div
      className={`cf-lexical-display-math${sourceEdit.active ? " is-editing" : ""}`}
    >
      {!sourceEdit.active ? (
        <>
          <div
            className="cf-lexical-display-math-body"
            dangerouslySetInnerHTML={{ __html: equation }}
            {...structureToggleProps(surfaceEditable, sourceEdit.activate)}
          />
          {label ? (
            <div
              className="cf-lexical-display-math-label"
              {...structureToggleProps(surfaceEditable, sourceEdit.activate)}
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
          />
        </div>
      )}
    </div>
  );
}
