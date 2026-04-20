import { useMemo } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { NodeKey } from "lexical";

import { parseFrontmatter } from "../../lib/frontmatter";
import { StructureSourceEditor } from "../structure-source-editor";
import { renderMarkdownRichHtml } from "../markdown/rich-html-preview";
import { useLexicalRenderContext } from "../render-context";
import { useLexicalSurfaceEditable } from "../editability-context";
import { useStructureEditToggle } from "../structure-edit-plugin";
import { useStructureSourceSelectionBridge } from "../structure-source-selection";
import { getPendingEmbeddedSurfaceFocusId } from "../pending-surface-focus";
import { structureToggleProps, useRawBlockUpdater } from "./shared";

function richHtmlOptions(context: ReturnType<typeof useLexicalRenderContext>) {
  return {
    citations: context.citations,
    config: context.config,
    docPath: context.docPath,
    renderIndex: context.renderIndex,
    resolveAssetUrl: context.resolveAssetUrl,
  };
}

export function FrontmatterRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const [editor] = useLexicalComposerContext();
  const surfaceEditable = useLexicalSurfaceEditable();
  const context = useLexicalRenderContext();
  const title = parseFrontmatter(raw).config.title ?? "";
  const updateRaw = useRawBlockUpdater(nodeKey);
  const sourceEdit = useStructureEditToggle(
    nodeKey,
    "frontmatter",
    "frontmatter-source",
  );
  const onSelectionChange = useStructureSourceSelectionBridge(editor, nodeKey);

  const titleHtml = useMemo(
    () => title ? renderMarkdownRichHtml(title, richHtmlOptions(context)) : "",
    [title, context],
  );

  return (
    <header className={`cf-lexical-title-shell${sourceEdit.active ? " is-editing-source" : ""}`}>
      {sourceEdit.active ? (
        <StructureSourceEditor
          className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-structure-source-editor cf-lexical-structure-source-editor--frontmatter"
          doc={raw}
          multiline
          namespace={`coflat-frontmatter-source-${nodeKey}`}
          onChange={updateRaw}
          onClose={sourceEdit.deactivate}
          onSelectionChange={onSelectionChange}
          pendingFocusId={getPendingEmbeddedSurfaceFocusId(editor.getKey(), nodeKey, "structure-source")}
        />
      ) : (
        <div
          className="cf-lexical-structure-toggle cf-lexical-structure-toggle--frontmatter"
          {...structureToggleProps(surfaceEditable, sourceEdit.activate, {
            keyboardActivation: true,
          })}
        >
          {title ? (
            <div
              className="cf-lexical-nested-editor cf-lexical-nested-editor--frontmatter-title"
              dangerouslySetInnerHTML={{ __html: titleHtml }}
            />
          ) : (
            <h1 className="cf-lexical-frontmatter-title cf-lexical-frontmatter-title--empty">Untitled</h1>
          )}
        </div>
      )}
    </header>
  );
}
