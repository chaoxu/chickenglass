import { useMemo } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { NodeKey } from "lexical";

import { LexicalRichMarkdownEditor } from "../rich-markdown-editor";
import { useIncludedDocument } from "../render-context";
import { StructureSourceEditor } from "../structure-source-editor";
import { useStructureEditToggle } from "../structure-edit-plugin";
import {
  fencedDivTrimmedBodyMarkdownOffset,
  useStructureSourceSelectionBridge,
} from "../structure-source-selection";
import { useLexicalSurfaceEditable } from "../editability-context";
import { parseStructuredFencedDivRaw } from "../markdown/block-syntax";
import { updateFencedDivField } from "./fenced-div-field";
import { structureToggleProps, useRawBlockUpdater } from "./shared";

export function IncludeBlockRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const surfaceEditable = useLexicalSurfaceEditable();
  const [editor] = useLexicalComposerContext();
  const parsed = useMemo(() => parseStructuredFencedDivRaw(raw), [raw]);
  const updateRaw = useRawBlockUpdater(nodeKey);
  const pathText = parsed.bodyMarkdown.trim();
  const content = useIncludedDocument(pathText);
  const pathEdit = useStructureEditToggle(nodeKey, "fenced-div", "include-path");
  const onPathSelectionChange = useStructureSourceSelectionBridge(
    editor,
    nodeKey,
    fencedDivTrimmedBodyMarkdownOffset(raw),
  );

  return (
    <section className="cf-lexical-include-shell">
      <div className="cf-lexical-include-meta">
        {surfaceEditable ? (
          <button
            className="cf-lexical-include-path-toggle cf-lexical-structure-toggle cf-lexical-structure-toggle--include"
            type="button"
            {...structureToggleProps(surfaceEditable, pathEdit.activate, {
              keyboardActivation: true,
            })}
          >
            {pathText}
          </button>
        ) : (
          <span className="cf-lexical-include-path-label">{pathText}</span>
        )}
      </div>
      {pathEdit.active ? (
        <StructureSourceEditor
          className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-structure-source-editor cf-lexical-structure-source-editor--include"
          doc={pathText}
          namespace={`coflat-include-path-${nodeKey}`}
          onChange={(nextPath) => updateRaw((currentRaw) => updateFencedDivField(currentRaw, {
            bodyMarkdown: nextPath,
          }))}
          onClose={pathEdit.deactivate}
          onSelectionChange={onPathSelectionChange}
        />
      ) : null}
      <div className="cf-lexical-include-content">
        {content ? (
          <LexicalRichMarkdownEditor
            doc={content}
            editable={false}
            editorClassName="cf-lexical-editor cf-lexical-nested-editor cf-lexical-nested-editor--include-preview"
            namespace={`coflat-include-preview-${nodeKey}`}
            showHeadingChrome={false}
            spellCheck={false}
            testId={null}
          />
        ) : (
          <div className="cf-lexical-media-fallback">{`Missing include: ${pathText}`}</div>
        )}
      </div>
    </section>
  );
}
