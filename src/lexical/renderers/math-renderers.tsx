import { useMemo, useRef, useState } from "react";
import katex from "katex";
import type { NodeKey } from "lexical";

import { useLexicalSurfaceEditable } from "../editability-context";
import { useLexicalRenderContext } from "../render-context";
import { StructureSourceEditor } from "../structure-source-editor";
import { parseStructuredDisplayMathRaw } from "../markdown/block-syntax";
import { buildKatexOptions } from "../../lib/katex-options";
import { structureToggleProps, useRawBlockUpdater } from "./shared";

function stripInlineMathDelimiters(raw: string): string {
  if (raw.startsWith("\\(") && raw.endsWith("\\)")) {
    return raw.slice(2, -2);
  }
  if (raw.startsWith("$") && raw.endsWith("$")) {
    return raw.slice(1, -1);
  }
  return raw;
}

export function InlineMathRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const { config } = useLexicalRenderContext();
  const body = useMemo(() => stripInlineMathDelimiters(raw), [raw]);
  const html = useMemo(
    () => katex.renderToString(body, buildKatexOptions(false, config.math)),
    [body, config.math],
  );

  return (
    <span
      className="cf-lexical-inline-math"
      data-coflat-inline-math-key={nodeKey}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

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
  const [editing, setEditing] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const equation = useMemo(
    () => katex.renderToString(parsed.body, buildKatexOptions(true, config.math)),
    [config.math, parsed.body],
  );
  const label = parsed.id ? renderIndex.references.get(parsed.id)?.shortLabel : undefined;

  return (
    <div
      className={`cf-lexical-display-math${editing ? " is-editing" : ""}`}
      onBlurCapture={(event) => {
        const nextFocused = event.relatedTarget;
        if (nextFocused instanceof Node && shellRef.current?.contains(nextFocused)) {
          return;
        }
        setEditing(false);
      }}
      ref={shellRef}
    >
      {!editing ? (
        <>
          <div
            className="cf-lexical-display-math-body"
            dangerouslySetInnerHTML={{ __html: equation }}
            {...structureToggleProps(surfaceEditable, () => setEditing(true))}
          />
          {label ? (
            <div
              className="cf-lexical-display-math-label"
              {...structureToggleProps(surfaceEditable, () => setEditing(true))}
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
            onClose={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}
