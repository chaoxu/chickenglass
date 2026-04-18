import { memo, useCallback, useMemo, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import katex from "katex";
import { $createParagraphNode, $getNodeByKey, type NodeKey } from "lexical";

import { useLexicalSurfaceEditable } from "../editability-context";
import { useLexicalRenderContext } from "../render-context";
import { StructureSourceEditor } from "../structure-source-editor";
import { useStructureEditToggle } from "../structure-edit-plugin";
import {
  getPendingEmbeddedSurfaceFocusId,
} from "../pending-surface-focus";
import { parseStructuredDisplayMathRaw } from "../markdown/block-syntax";
import { useStructureSourcePositionEntry } from "../structure-source-position-entry";
import { displayMathSourceOffsetFromTarget } from "../math-source-position";
import { EditorChromeBody, EditorChromePanel } from "../editor-chrome";
import { buildKatexOptions } from "../../lib/katex-options";
import {
  preventKatexMouseDown,
  structureToggleProps,
  useRawBlockUpdater,
} from "./shared";

const DISPLAY_MATH_CLOSE_RE = /^\s*\$\$(?:\s+\{#[^}]+\})?\s*$/;

/**
 * Detect the "user typed an extra `$$` to exit" gesture. The source editor
 * is pre-populated with `$$\n\n$$`; if the user — expecting to type the close
 * themselves — adds a second `$$` on its own line, everything subsequent
 * leaks into the raw block until something else deactivates it. Recognize
 * the double-close pattern, trim the raw back to one clean block, and
 * signal the caller to deactivate the source editor.
 */
function tryTrimOnDoubleClose(raw: string): string | null {
  const lines = raw.split("\n");
  const closeIndices: number[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    if (DISPLAY_MATH_CLOSE_RE.test(lines[i])) {
      closeIndices.push(i);
      if (closeIndices.length >= 2) break;
    }
  }
  if (closeIndices.length < 2) return null;
  return lines.slice(0, closeIndices[0] + 1).join("\n");
}

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
  const updateRawInner = useRawBlockUpdater(nodeKey);
  const sourceEdit = useStructureEditToggle(
    nodeKey,
    "display-math",
    "display-math-source",
  );
  const updateRaw = useCallback((nextRaw: string) => {
    const trimmed = tryTrimOnDoubleClose(nextRaw);
    if (trimmed !== null) {
      updateRawInner(trimmed);
      sourceEdit.deactivate();
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (!node) return;
        const next = node.getNextSibling();
        if (next) {
          next.selectStart();
          return;
        }
        const paragraph = $createParagraphNode();
        node.insertAfter(paragraph);
        paragraph.selectStart();
      });
      editor.focus();
      return;
    }
    updateRawInner(nextRaw);
  }, [updateRawInner, sourceEdit, editor, nodeKey]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const sourceFocusId = getPendingEmbeddedSurfaceFocusId(editor.getKey(), nodeKey, "structure-source");
  // Display math always renders eagerly. The KaTeX string is memoized on
  // parsed.body, and there are rarely enough display-math blocks per doc for
  // lazy gating to matter. Lazy gating also interacts badly with Lexical's
  // node-key churn: each raw-block mutation spawns a fresh renderer instance
  // with visible=false, and IntersectionObserver often does not catch up
  // before the next mount.
  const visible = true;
  const equation = useMemo(
    () => visible
      ? katex.renderToString(parsed.body, buildKatexOptions(true, config.math))
      : null,
    [config.math, parsed.body, visible],
  );
  const label = parsed.id ? renderIndex.references.get(parsed.id)?.shortLabel : undefined;
  const rememberSourcePosition = useStructureSourcePositionEntry({
    editor,
    raw,
    sourceFocusId,
    sourceOffsetFromTarget: displayMathSourceOffsetFromTarget,
  });

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
                keyboardActivation: true,
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
                keyboardActivation: true,
                onBeforeActivate: rememberSourcePosition,
              })}
            />
          )}
          {label ? (
            <div
              className="cf-lexical-display-math-label"
              {...structureToggleProps(surfaceEditable, sourceEdit.activate, {
                keyboardActivation: true,
                onBeforeActivate: rememberSourcePosition,
              })}
            >
              {label}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="cf-lexical-display-math-editor">
            <StructureSourceEditor
              className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-structure-source-editor cf-lexical-structure-source-editor--math"
              doc={raw}
              multiline
              namespace={`coflat-display-math-${nodeKey}`}
              onChange={updateRaw}
              onClose={sourceEdit.deactivate}
              pendingFocusId={sourceFocusId}
            />
          </div>
          <EditorChromePanel className="cf-lexical-display-math-preview-shell">
            <EditorChromeBody className="cf-lexical-display-math-preview-surface">
              <div className="cf-lexical-display-math-preview-label">KaTeX</div>
              <div className="cf-lexical-display-math-preview-row">
                <div
                  className="cf-lexical-display-math-preview-equation"
                  dangerouslySetInnerHTML={{ __html: equation ?? "" }}
                  onMouseDown={preventKatexMouseDown}
                />
                {label ? (
                  <div className="cf-lexical-display-math-preview-number">
                    {label}
                  </div>
                ) : null}
              </div>
            </EditorChromeBody>
          </EditorChromePanel>
        </>
      )}
    </div>
  );
});
